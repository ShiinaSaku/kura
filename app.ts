import { Hono } from "hono";
import { z } from "zod";
import { renderStatsCard } from "./src/cards/stats";
import { renderRepoCard } from "./src/cards/repo";
import { renderTopLanguages } from "./src/cards/top-languages";
import { renderWakatimeCard } from "./src/cards/wakatime";
import { renderGistCard } from "./src/cards/gist";
import { guardAccess } from "./src/common/access";
import {
  getGitHubTokens,
  parseCsvBinding,
  type AppBindings,
  type HonoEnv,
} from "./src/common/bindings.js";
import {
  applyConditionalRequest,
  CACHE_TTL,
  createCardCacheHeaders,
  createCacheHeaders,
  createEntityTag,
  createErrorCacheHeaders,
  createNoCacheHeaders,
  mergeHeaders,
  resolveCacheSeconds,
} from "./src/common/cache";
import { MissingParamError, retrieveSecondaryMessage } from "./src/common/error";
import { createGitHubClient, createRetryingGitHubClientFromBindings } from "./src/common/github.js";
import { parseArray, parseBoolean, dateDiff } from "./src/common/ops";
import { renderError } from "./src/common/render";
import { fetchStats } from "./src/fetchers/stats.js";
import { fetchRepo } from "./src/fetchers/repo.js";
import { fetchTopLanguages } from "./src/fetchers/top-languages.js";
import { fetchWakatimeStats } from "./src/fetchers/wakatime.js";
import { fetchGist } from "./src/fetchers/gist.js";
import { isLocaleAvailable } from "./src/translations.js";

type QueryParams = Record<string, string | undefined>;

type RenderColors = {
  title_color: string | undefined;
  text_color: string | undefined;
  bg_color: string | undefined;
  border_color: string | undefined;
  theme: string | undefined;
};

type StatusType = "boolean" | "json" | "shields";

type GraphqlError = {
  type?: string;
  message?: string;
};

type RateLimitData = {
  rateLimit?: {
    remaining: number;
    resetAt?: string;
  };
};

type GraphqlPayload<TData> = {
  data?: TData;
  errors?: GraphqlError[];
};

type TokenStatus = "valid" | "expired" | "exhausted" | "suspended" | "error";

type TokenErrorDetail = {
  type: string | undefined;
  message: string | undefined;
};

type TokenDetail =
  | { status: "valid"; remaining: number }
  | { status: "expired" }
  | { status: "suspended" }
  | { status: "exhausted"; remaining: 0; resetIn: string }
  | { status: "error"; error: TokenErrorDetail };

type TokenInfo = {
  validPATs: string[];
  expiredPATs: string[];
  exhaustedPATs: string[];
  suspendedPATs: string[];
  errorPATs: string[];
  details: Record<string, TokenDetail>;
};

type ShieldsBadge = {
  schemaVersion: 1;
  label: string;
  isError: true;
  message: "up" | "down";
  color: "brightgreen" | "red";
};

export const RATE_LIMIT_SECONDS = 60 * 5;

const app = new Hono<HonoEnv>();

const LEGACY_CARD_ROUTES = new Set([
  "/api",
  "/api/pin",
  "/api/top-langs",
  "/api/wakatime",
  "/api/gist",
]);

const applyCardRouteCacheDefaults = async (
  c: Parameters<Parameters<typeof app.use>[1]>[0],
  next: Parameters<Parameters<typeof app.use>[1]>[1],
) => {
  await next();

  if (!LEGACY_CARD_ROUTES.has(c.req.path)) {
    return;
  }

  if (!c.res.headers.has("Cache-Control")) {
    c.res.headers.set("Cache-Control", "no-store");
  }

  c.res.headers.set("Vary", "Accept-Encoding");
};

app.use("/api", applyCardRouteCacheDefaults);
app.use("/api/*", applyCardRouteCacheDefaults);

function getQueryParams(query: Record<string, string>): QueryParams {
  return query;
}

function toInteger(value: string | undefined): number {
  return Number.parseInt(value ?? "", 10);
}

function toFloat(value: string | undefined): number {
  return Number.parseFloat(value ?? "");
}

function parseEnum<T extends string>(
  value: string | undefined,
  allowedValues: readonly T[],
): T | undefined {
  if (value === undefined) {
    return undefined;
  }

  return (allowedValues as readonly string[]).includes(value) ? (value as T) : undefined;
}

const commitsYearSchema = z.preprocess(
  (value) => {
    if (value === undefined || value === "") {
      return undefined;
    }

    return value;
  },
  z.coerce
    .number()
    .int()
    .min(1970)
    .max(new Date().getUTCFullYear() + 1)
    .optional(),
);

function parseCommitsYear(value: string | undefined): number | undefined {
  const parsed = commitsYearSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error("Invalid commits_year. Expected a valid year like 2025.");
  }

  return parsed.data;
}

function getColors(query: QueryParams): RenderColors {
  return {
    title_color: query.title_color,
    text_color: query.text_color,
    bg_color: query.bg_color,
    border_color: query.border_color,
    theme: query.theme,
  };
}

function createSvgResponse(request: Request, svg: string, headers: HeadersInit): Response {
  const response = new Response(svg, {
    status: 200,
    headers: mergeHeaders(headers, {
      "Content-Type": "image/svg+xml; charset=utf-8",
      ETag: createEntityTag(svg),
    }),
  });

  return applyConditionalRequest(request, response);
}

function createSvgErrorResponse(
  request: Request,
  error: unknown,
  colors: RenderColors,
  headers: HeadersInit = createErrorCacheHeaders(),
): Response {
  const renderOptions = {
    title_color: colors.title_color,
    text_color: colors.text_color,
    bg_color: colors.bg_color,
    border_color: colors.border_color,
    theme: colors.theme,
  };

  if (error instanceof Error) {
    return createSvgResponse(
      request,
      renderError({
        message: error.message,
        secondaryMessage: retrieveSecondaryMessage(error),
        renderOptions: {
          ...renderOptions,
          show_repo_link: !(error instanceof MissingParamError),
        },
      }),
      headers,
    );
  }

  return createSvgResponse(
    request,
    renderError({
      message: "An unknown error occurred",
      renderOptions,
    }),
    headers,
  );
}

function createLocaleErrorResponse(
  request: Request,
  colors: RenderColors,
  secondaryMessage: string,
): Response {
  return createSvgResponse(
    request,
    renderError({
      message: "Something went wrong",
      secondaryMessage,
      renderOptions: colors,
    }),
    createErrorCacheHeaders(),
  );
}

function createStatusResponse(
  body: BodyInit | null,
  status: number,
  headers?: HeadersInit,
): Response {
  if (headers === undefined) {
    return new Response(body, { status });
  }

  return new Response(body, {
    status,
    headers: mergeHeaders(headers),
  });
}

function getStatusHeaders(sharedMaxAge: number): Headers {
  return createCacheHeaders({
    browserMaxAge: 0,
    sharedMaxAge,
    staleWhileRevalidate: 0,
  });
}

function isRateLimited(payload: GraphqlPayload<RateLimitData>): boolean {
  const firstError = payload.errors?.[0];
  return firstError?.type === "RATE_LIMITED" || payload.data?.rateLimit?.remaining === 0;
}

async function fetchRateLimit(bindings: AppBindings): Promise<GraphqlPayload<RateLimitData>> {
  const client = createRetryingGitHubClientFromBindings(bindings);
  return client.graphql<RateLimitData>({
    query: "query { rateLimit { remaining resetAt } }",
  });
}

async function fetchRateLimitForToken(token: string): Promise<GraphqlPayload<RateLimitData>> {
  const client = createGitHubClient({ token });
  return client.graphql<RateLimitData>({
    query: "query { rateLimit { remaining resetAt } }",
  });
}

function getErrorMessage(error: unknown): string | undefined {
  if (!(error instanceof Error)) {
    return undefined;
  }

  const response = error as Error & {
    response?: {
      data?: {
        message?: string;
      };
    };
  };

  return response.response?.data?.message;
}

async function isInstanceUp(bindings: AppBindings): Promise<boolean> {
  if (getGitHubTokens(bindings).length === 0) {
    return false;
  }

  try {
    const payload = await fetchRateLimit(bindings);
    if (!isRateLimited(payload)) {
      return true;
    }
  } catch (error) {
    const message = getErrorMessage(error)?.toLowerCase();
    if (message === "bad credentials" || message === "sorry. your account was suspended.") {
      return false;
    }
  }

  return false;
}

function shieldsUptimeBadge(up: boolean): ShieldsBadge {
  return {
    schemaVersion: 1,
    label: "Public Instance",
    isError: true,
    message: up ? "up" : "down",
    color: up ? "brightgreen" : "red",
  };
}

function filterTokenKeys(details: Record<string, TokenDetail>, status: TokenStatus): string[] {
  return Object.keys(details).filter((key) => details[key]?.status === status);
}

export async function getPATInfo(bindings: AppBindings): Promise<TokenInfo> {
  const details: Record<string, TokenDetail> = {};
  const tokens = getGitHubTokens(bindings);

  for (const [key, token] of tokens) {
    try {
      const payload = await fetchRateLimitForToken(token);
      const firstError = payload.errors?.[0];

      if (firstError !== undefined && firstError.type !== "RATE_LIMITED") {
        details[key] = {
          status: "error",
          error: {
            type: firstError.type,
            message: firstError.message,
          },
        };
        continue;
      }

      if (isRateLimited(payload)) {
        const resetAt = payload.data?.rateLimit?.resetAt;
        const resetDate = resetAt === undefined ? new Date() : new Date(resetAt);
        details[key] = {
          status: "exhausted",
          remaining: 0,
          resetIn: `${dateDiff(resetDate, new Date())} minutes`,
        };
        continue;
      }

      details[key] = {
        status: "valid",
        remaining: payload.data?.rateLimit?.remaining ?? 0,
      };
    } catch (error) {
      const message = getErrorMessage(error)?.toLowerCase();

      if (message === "bad credentials") {
        details[key] = { status: "expired" };
        continue;
      }

      if (message === "sorry. your account was suspended.") {
        details[key] = { status: "suspended" };
        continue;
      }

      throw error;
    }
  }

  const sortedDetails = Object.keys(details)
    .sort()
    .reduce<Record<string, TokenDetail>>((accumulator, key) => {
      accumulator[key] = details[key];
      return accumulator;
    }, {});

  return {
    validPATs: filterTokenKeys(sortedDetails, "valid"),
    expiredPATs: filterTokenKeys(sortedDetails, "expired"),
    exhaustedPATs: filterTokenKeys(sortedDetails, "exhausted"),
    suspendedPATs: filterTokenKeys(sortedDetails, "suspended"),
    errorPATs: filterTokenKeys(sortedDetails, "error"),
    details: sortedDetails,
  };
}

app.get("/api", async (c) => {
  const query = getQueryParams(c.req.query());
  const colors = getColors(query);
  const access = guardAccess({ id: query.username, type: "username", colors });

  if (!access.isPassed) {
    return createSvgResponse(c.req.raw, access.svg, createNoCacheHeaders());
  }

  if (query.locale !== undefined && !isLocaleAvailable(query.locale)) {
    return createLocaleErrorResponse(c.req.raw, colors, "Language not found");
  }

  try {
    const showStats = parseArray(query.show);
    const commitsYear = parseCommitsYear(query.commits_year);
    const githubClient = createRetryingGitHubClientFromBindings(c.env);
    const stats = await fetchStats(
      query.username,
      {
        includeAllCommits: parseBoolean(query.include_all_commits),
        excludeRepositories: parseArray(query.exclude_repo),
        defaultExcludeRepositories: parseCsvBinding(c.env.EXCLUDE_REPO),
        includeMergedPullRequests:
          showStats.includes("prs_merged") || showStats.includes("prs_merged_percentage"),
        includeDiscussions: showStats.includes("discussions_started"),
        includeDiscussionsAnswers: showStats.includes("discussions_answered"),
        commitsYear,
        fetchMultiPageStars: c.env.FETCH_MULTI_PAGE_STARS === "true",
      },
      githubClient,
    );
    const cacheSeconds = resolveCacheSeconds({
      requested: toInteger(query.cache_seconds),
      def: CACHE_TTL.STATS_CARD.DEFAULT,
      min: CACHE_TTL.STATS_CARD.MIN,
      max: CACHE_TTL.STATS_CARD.MAX,
    });

    return createSvgResponse(
      c.req.raw,
      renderStatsCard(stats, {
        hide: parseArray(query.hide),
        show_icons: parseBoolean(query.show_icons),
        hide_title: parseBoolean(query.hide_title),
        hide_border: parseBoolean(query.hide_border),
        card_width: toInteger(query.card_width),
        hide_rank: parseBoolean(query.hide_rank),
        include_all_commits: parseBoolean(query.include_all_commits),
        commits_year: commitsYear,
        line_height: query.line_height,
        title_color: query.title_color,
        ring_color: query.ring_color,
        icon_color: query.icon_color,
        text_color: query.text_color,
        text_bold: parseBoolean(query.text_bold),
        bg_color: query.bg_color,
        theme: query.theme,
        custom_title: query.custom_title,
        border_radius: toFloat(query.border_radius),
        border_color: query.border_color,
        number_format: query.number_format,
        number_precision: toInteger(query.number_precision),
        locale: query.locale?.toLowerCase(),
        disable_animations: parseBoolean(query.disable_animations),
        rank_icon: parseEnum(query.rank_icon, ["default", "github", "percentile"] as const),
        show: showStats,
      }),
      createCardCacheHeaders(cacheSeconds),
    );
  } catch (error) {
    return createSvgErrorResponse(c.req.raw, error, colors);
  }
});

app.get("/api/pin", async (c) => {
  const query = getQueryParams(c.req.query());
  const colors = getColors(query);
  const access = guardAccess({ id: query.username, type: "username", colors });

  if (!access.isPassed) {
    return createSvgResponse(c.req.raw, access.svg, createNoCacheHeaders());
  }

  if (query.locale !== undefined && !isLocaleAvailable(query.locale)) {
    return createLocaleErrorResponse(c.req.raw, colors, "Language not found");
  }

  try {
    const githubClient = createRetryingGitHubClientFromBindings(c.env);
    const repoData = await fetchRepo(query.username, query.repo, githubClient);
    const cacheSeconds = resolveCacheSeconds({
      requested: toInteger(query.cache_seconds),
      def: CACHE_TTL.PIN_CARD.DEFAULT,
      min: CACHE_TTL.PIN_CARD.MIN,
      max: CACHE_TTL.PIN_CARD.MAX,
    });

    return createSvgResponse(
      c.req.raw,
      renderRepoCard(repoData, {
        hide_border: parseBoolean(query.hide_border),
        title_color: query.title_color,
        icon_color: query.icon_color,
        text_color: query.text_color,
        bg_color: query.bg_color,
        theme: query.theme,
        border_radius: toFloat(query.border_radius),
        border_color: query.border_color,
        show_owner: parseBoolean(query.show_owner),
        locale: query.locale?.toLowerCase(),
        description_lines_count: toInteger(query.description_lines_count),
      }),
      createCardCacheHeaders(cacheSeconds),
    );
  } catch (error) {
    return createSvgErrorResponse(c.req.raw, error, colors);
  }
});

app.get("/api/top-langs", async (c) => {
  const query = getQueryParams(c.req.query());
  const colors = getColors(query);
  const access = guardAccess({ id: query.username, type: "username", colors });

  if (!access.isPassed) {
    return createSvgResponse(c.req.raw, access.svg, createNoCacheHeaders());
  }

  if (query.locale !== undefined && !isLocaleAvailable(query.locale)) {
    return createLocaleErrorResponse(c.req.raw, colors, "Locale not found");
  }

  if (
    query.layout !== undefined &&
    !["compact", "normal", "donut", "donut-vertical", "pie"].includes(query.layout)
  ) {
    return createLocaleErrorResponse(c.req.raw, colors, "Incorrect layout input");
  }

  if (query.stats_format !== undefined && !["default", "percent"].includes(query.stats_format)) {
    return createLocaleErrorResponse(c.req.raw, colors, "Incorrect stats_format input");
  }

  try {
    const githubClient = createRetryingGitHubClientFromBindings(c.env);
    const topLangs = await fetchTopLanguages(
      query.username,
      {
        excludeRepositories: parseArray(query.exclude_repo),
        defaultExcludeRepositories: parseCsvBinding(c.env.EXCLUDE_REPO),
        sizeWeight: toFloat(query.size_weight),
        countWeight: toFloat(query.count_weight),
      },
      githubClient,
    );
    const cacheSeconds = resolveCacheSeconds({
      requested: toInteger(query.cache_seconds),
      def: CACHE_TTL.TOP_LANGS_CARD.DEFAULT,
      min: CACHE_TTL.TOP_LANGS_CARD.MIN,
      max: CACHE_TTL.TOP_LANGS_CARD.MAX,
    });

    return createSvgResponse(
      c.req.raw,
      renderTopLanguages(topLangs, {
        custom_title: query.custom_title,
        hide_title: parseBoolean(query.hide_title),
        hide_border: parseBoolean(query.hide_border),
        card_width: toInteger(query.card_width),
        hide: parseArray(query.hide),
        title_color: query.title_color,
        text_color: query.text_color,
        bg_color: query.bg_color,
        theme: query.theme,
        langs_count: toInteger(query.langs_count),
        border_radius: toFloat(query.border_radius),
        border_color: query.border_color,
        locale: query.locale?.toLowerCase(),
        disable_animations: parseBoolean(query.disable_animations),
        hide_progress: parseBoolean(query.hide_progress),
        layout: parseEnum(query.layout, [
          "compact",
          "normal",
          "donut",
          "donut-vertical",
          "pie",
        ] as const),
        stats_format: parseEnum(query.stats_format, ["percentages", "bytes"] as const),
      }),
      createCardCacheHeaders(cacheSeconds),
    );
  } catch (error) {
    return createSvgErrorResponse(c.req.raw, error, colors);
  }
});

app.get("/api/wakatime", async (c) => {
  const query = getQueryParams(c.req.query());
  const colors = getColors(query);
  const access = guardAccess({ id: query.username, type: "wakatime", colors });

  if (!access.isPassed) {
    return createSvgResponse(c.req.raw, access.svg, createNoCacheHeaders());
  }

  if (query.locale !== undefined && !isLocaleAvailable(query.locale)) {
    return createLocaleErrorResponse(c.req.raw, colors, "Language not found");
  }

  try {
    const stats = await fetchWakatimeStats(
      query.api_domain === undefined
        ? { username: query.username }
        : { username: query.username, apiDomain: query.api_domain },
    );
    const cacheSeconds = resolveCacheSeconds({
      requested: toInteger(query.cache_seconds),
      def: CACHE_TTL.WAKATIME_CARD.DEFAULT,
      min: CACHE_TTL.WAKATIME_CARD.MIN,
      max: CACHE_TTL.WAKATIME_CARD.MAX,
    });

    return createSvgResponse(
      c.req.raw,
      renderWakatimeCard(stats, {
        custom_title: query.custom_title,
        hide_title: parseBoolean(query.hide_title),
        hide_border: parseBoolean(query.hide_border),
        card_width: toInteger(query.card_width),
        hide: parseArray(query.hide),
        line_height: query.line_height,
        title_color: query.title_color,
        icon_color: query.icon_color,
        text_color: query.text_color,
        bg_color: query.bg_color,
        theme: query.theme,
        hide_progress: parseBoolean(query.hide_progress),
        border_radius: toFloat(query.border_radius),
        border_color: query.border_color,
        locale: query.locale?.toLowerCase(),
        layout: parseEnum(query.layout, ["compact", "normal"] as const),
        langs_count: toInteger(query.langs_count),
        display_format: parseEnum(query.display_format, ["time", "percent"] as const),
        disable_animations: parseBoolean(query.disable_animations),
      }),
      createCardCacheHeaders(cacheSeconds),
    );
  } catch (error) {
    return createSvgErrorResponse(c.req.raw, error, colors);
  }
});

app.get("/api/gist", async (c) => {
  const query = getQueryParams(c.req.query());
  const colors = getColors(query);
  const access = guardAccess({ id: query.id, type: "gist", colors });

  if (!access.isPassed) {
    return createSvgResponse(c.req.raw, access.svg, createNoCacheHeaders());
  }

  if (query.locale !== undefined && !isLocaleAvailable(query.locale)) {
    return createLocaleErrorResponse(c.req.raw, colors, "Language not found");
  }

  try {
    const githubClient = createRetryingGitHubClientFromBindings(c.env);
    const gistData = await fetchGist(query.id, githubClient);
    const cacheSeconds = resolveCacheSeconds({
      requested: toInteger(query.cache_seconds),
      def: CACHE_TTL.GIST_CARD.DEFAULT,
      min: CACHE_TTL.GIST_CARD.MIN,
      max: CACHE_TTL.GIST_CARD.MAX,
    });

    return createSvgResponse(
      c.req.raw,
      renderGistCard(gistData, {
        title_color: query.title_color,
        icon_color: query.icon_color,
        text_color: query.text_color,
        bg_color: query.bg_color,
        theme: query.theme,
        border_radius: toFloat(query.border_radius),
        border_color: query.border_color,
        locale: query.locale?.toLowerCase(),
        show_owner: parseBoolean(query.show_owner),
        hide_border: parseBoolean(query.hide_border),
      }),
      createCardCacheHeaders(cacheSeconds),
    );
  } catch (error) {
    return createSvgErrorResponse(c.req.raw, error, colors);
  }
});

app.get("/api/status/up", async (c) => {
  const type = (c.req.query("type")?.toLowerCase() as StatusType | undefined) ?? "boolean";

  try {
    const up = await isInstanceUp(c.env);
    const headers = up ? getStatusHeaders(RATE_LIMIT_SECONDS) : createNoCacheHeaders();

    if (type === "shields") {
      return createStatusResponse(
        JSON.stringify(shieldsUptimeBadge(up)),
        200,
        mergeHeaders(headers, {
          "Content-Type": "application/json; charset=utf-8",
        }),
      );
    }

    if (type === "json") {
      return createStatusResponse(
        JSON.stringify({ up }),
        200,
        mergeHeaders(headers, {
          "Content-Type": "application/json; charset=utf-8",
        }),
      );
    }

    return createStatusResponse(
      String(up),
      200,
      mergeHeaders(headers, {
        "Content-Type": "application/json; charset=utf-8",
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return createStatusResponse(`Something went wrong: ${message}`, 500, {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
    });
  }
});

app.get("/api/status/pat-info", async (c) => {
  try {
    const info = await getPATInfo(c.env);
    return createStatusResponse(JSON.stringify(info), 200, {
      ...Object.fromEntries(getStatusHeaders(RATE_LIMIT_SECONDS).entries()),
      "Content-Type": "application/json; charset=utf-8",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return createStatusResponse(`Something went wrong: ${message}`, 500, {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
    });
  }
});

export { app };
export default app;
