// @ts-nocheck

import { Hono } from "hono";
import { renderStatsCard } from "../src/cards/stats.js";
import { renderRepoCard } from "../src/cards/repo.js";
import { renderTopLanguages } from "../src/cards/top-languages.js";
import { renderWakatimeCard } from "../src/cards/wakatime.js";
import { renderGistCard } from "../src/cards/gist.js";
import { guardAccess } from "../src/common/access.js";
import {
  CACHE_TTL,
  resolveCacheSeconds,
  setCacheHeaders,
  setErrorCacheHeaders,
} from "../src/common/cache.js";
import { MissingParamError, retrieveSecondaryMessage } from "../src/common/error.js";
import { parseArray, parseBoolean } from "../src/common/ops.js";
import { renderError } from "../src/common/render.js";
import { fetchStats } from "../src/fetchers/stats.js";
import { fetchRepo } from "../src/fetchers/repo.js";
import { fetchTopLanguages } from "../src/fetchers/top-languages.js";
import { fetchWakatimeStats } from "../src/fetchers/wakatime.js";
import { fetchGist } from "../src/fetchers/gist.js";
import { isLocaleAvailable } from "../src/translations.js";
import { request } from "../src/common/http.js";
import { logger } from "../src/common/log.js";
import { dateDiff } from "../src/common/ops.js";
import retryer from "../src/common/retryer.js";

export const RATE_LIMIT_SECONDS = 60 * 5; // 1 request per 5 minutes

const app = new Hono();

/** @param {import('hono').Context} c */
const svgResponse = (c, svg, cacheHeaders) => {
  return c.text(svg, 200, {
    "Content-Type": "image/svg+xml",
    ...cacheHeaders,
  });
};

/** @param {import('hono').Context} c */
const svgError = (c, err, colors, cacheHeaders) => {
  const { title_color, text_color, bg_color, border_color, theme } = colors;
  if (err instanceof Error) {
    return c.text(
      renderError({
        message: err.message,
        secondaryMessage: retrieveSecondaryMessage(err),
        renderOptions: {
          title_color,
          text_color,
          bg_color,
          border_color,
          theme,
          show_repo_link: !(err instanceof MissingParamError),
        },
      }),
      200,
      { "Content-Type": "image/svg+xml", ...cacheHeaders },
    );
  }
  return c.text(
    renderError({
      message: "An unknown error occurred",
      renderOptions: { title_color, text_color, bg_color, border_color, theme },
    }),
    200,
    { "Content-Type": "image/svg+xml", ...cacheHeaders },
  );
};

// ─── /api — Stats card ────────────────────────────────────────────────────────
app.get("/api", async (c) => {
  const q = c.req.query();
  const {
    username,
    hide,
    hide_title,
    hide_border,
    card_width,
    hide_rank,
    show_icons,
    include_all_commits,
    commits_year,
    line_height,
    title_color,
    ring_color,
    icon_color,
    text_color,
    text_bold,
    bg_color,
    theme,
    cache_seconds,
    exclude_repo,
    custom_title,
    locale,
    disable_animations,
    border_radius,
    number_format,
    number_precision,
    border_color,
    rank_icon,
    show,
  } = q;

  const colors = { title_color, text_color, bg_color, border_color, theme };

  const access = guardAccess({ id: username, type: "username", colors });
  if (!access.isPassed) return c.text(access.svg, 200, { "Content-Type": "image/svg+xml" });

  if (locale && !isLocaleAvailable(locale)) {
    return c.text(
      renderError({
        message: "Something went wrong",
        secondaryMessage: "Language not found",
        renderOptions: colors,
      }),
      200,
      { "Content-Type": "image/svg+xml" },
    );
  }

  try {
    const showStats = parseArray(show);
    const stats = await fetchStats(
      username,
      parseBoolean(include_all_commits),
      parseArray(exclude_repo),
      showStats.includes("prs_merged") || showStats.includes("prs_merged_percentage"),
      showStats.includes("discussions_started"),
      showStats.includes("discussions_answered"),
      parseInt(commits_year, 10),
    );
    const cacheSeconds = resolveCacheSeconds({
      requested: parseInt(cache_seconds, 10),
      def: CACHE_TTL.STATS_CARD.DEFAULT,
      min: CACHE_TTL.STATS_CARD.MIN,
      max: CACHE_TTL.STATS_CARD.MAX,
    });

    const headers = buildCacheHeaders(cacheSeconds);
    return svgResponse(
      c,
      renderStatsCard(stats, {
        hide: parseArray(hide),
        show_icons: parseBoolean(show_icons),
        hide_title: parseBoolean(hide_title),
        hide_border: parseBoolean(hide_border),
        card_width: parseInt(card_width, 10),
        hide_rank: parseBoolean(hide_rank),
        include_all_commits: parseBoolean(include_all_commits),
        commits_year: parseInt(commits_year, 10),
        line_height,
        title_color,
        ring_color,
        icon_color,
        text_color,
        text_bold: parseBoolean(text_bold),
        bg_color,
        theme,
        custom_title,
        border_radius: parseFloat(border_radius),
        border_color,
        number_format,
        number_precision: parseInt(number_precision, 10),
        locale: locale ? locale.toLowerCase() : undefined,
        disable_animations: parseBoolean(disable_animations),
        rank_icon,
        show: showStats,
      }),
      headers,
    );
  } catch (err) {
    return svgError(c, err, colors, buildErrorCacheHeaders());
  }
});

// ─── /api/pin — Repo card ─────────────────────────────────────────────────────
app.get("/api/pin", async (c) => {
  const {
    username,
    repo,
    hide_border,
    title_color,
    icon_color,
    text_color,
    bg_color,
    theme,
    show_owner,
    cache_seconds,
    locale,
    border_radius,
    border_color,
    description_lines_count,
  } = c.req.query();

  const colors = { title_color, text_color, bg_color, border_color, theme };

  const access = guardAccess({ id: username, type: "username", colors });
  if (!access.isPassed) return c.text(access.svg, 200, { "Content-Type": "image/svg+xml" });

  if (locale && !isLocaleAvailable(locale)) {
    return c.text(
      renderError({
        message: "Something went wrong",
        secondaryMessage: "Language not found",
        renderOptions: colors,
      }),
      200,
      { "Content-Type": "image/svg+xml" },
    );
  }

  try {
    const repoData = await fetchRepo(username, repo);
    const cacheSeconds = resolveCacheSeconds({
      requested: parseInt(cache_seconds, 10),
      def: CACHE_TTL.PIN_CARD.DEFAULT,
      min: CACHE_TTL.PIN_CARD.MIN,
      max: CACHE_TTL.PIN_CARD.MAX,
    });
    return svgResponse(
      c,
      renderRepoCard(repoData, {
        hide_border: parseBoolean(hide_border),
        title_color,
        icon_color,
        text_color,
        bg_color,
        theme,
        border_radius: parseFloat(border_radius),
        border_color,
        show_owner: parseBoolean(show_owner),
        locale: locale ? locale.toLowerCase() : undefined,
        description_lines_count: parseInt(description_lines_count, 10),
      }),
      buildCacheHeaders(cacheSeconds),
    );
  } catch (err) {
    return svgError(c, err, colors, buildErrorCacheHeaders());
  }
});

// ─── /api/top-langs — Top languages card ──────────────────────────────────────
app.get("/api/top-langs", async (c) => {
  const {
    username,
    hide,
    hide_title,
    hide_border,
    card_width,
    title_color,
    text_color,
    bg_color,
    theme,
    cache_seconds,
    layout,
    langs_count,
    exclude_repo,
    size_weight,
    count_weight,
    custom_title,
    locale,
    border_radius,
    border_color,
    disable_animations,
    hide_progress,
    stats_format,
  } = c.req.query();

  const colors = { title_color, text_color, bg_color, border_color, theme };

  const access = guardAccess({ id: username, type: "username", colors });
  if (!access.isPassed) return c.text(access.svg, 200, { "Content-Type": "image/svg+xml" });

  if (locale && !isLocaleAvailable(locale)) {
    return c.text(
      renderError({
        message: "Something went wrong",
        secondaryMessage: "Locale not found",
        renderOptions: colors,
      }),
      200,
      { "Content-Type": "image/svg+xml" },
    );
  }

  if (
    layout !== undefined &&
    (typeof layout !== "string" ||
      !["compact", "normal", "donut", "donut-vertical", "pie"].includes(layout))
  ) {
    return c.text(
      renderError({
        message: "Something went wrong",
        secondaryMessage: "Incorrect layout input",
        renderOptions: colors,
      }),
      200,
      { "Content-Type": "image/svg+xml" },
    );
  }

  if (
    stats_format !== undefined &&
    (typeof stats_format !== "string" || !["default", "percent"].includes(stats_format))
  ) {
    return c.text(
      renderError({
        message: "Something went wrong",
        secondaryMessage: "Incorrect stats_format input",
        renderOptions: colors,
      }),
      200,
      { "Content-Type": "image/svg+xml" },
    );
  }

  try {
    const topLangs = await fetchTopLanguages(
      username,
      parseArray(exclude_repo),
      parseFloat(size_weight),
      parseFloat(count_weight),
    );
    const cacheSeconds = resolveCacheSeconds({
      requested: parseInt(cache_seconds, 10),
      def: CACHE_TTL.TOP_LANGS_CARD.DEFAULT,
      min: CACHE_TTL.TOP_LANGS_CARD.MIN,
      max: CACHE_TTL.TOP_LANGS_CARD.MAX,
    });
    return svgResponse(
      c,
      renderTopLanguages(topLangs, {
        custom_title,
        hide_title: parseBoolean(hide_title),
        hide_border: parseBoolean(hide_border),
        card_width: parseInt(card_width, 10),
        hide: parseArray(hide),
        title_color,
        text_color,
        bg_color,
        theme,
        layout,
        langs_count: parseInt(langs_count, 10),
        border_radius: parseFloat(border_radius),
        border_color,
        locale: locale ? locale.toLowerCase() : undefined,
        disable_animations: parseBoolean(disable_animations),
        hide_progress: parseBoolean(hide_progress),
        stats_format,
      }),
      buildCacheHeaders(cacheSeconds),
    );
  } catch (err) {
    return svgError(c, err, colors, buildErrorCacheHeaders());
  }
});

// ─── /api/wakatime — WakaTime card ────────────────────────────────────────────
app.get("/api/wakatime", async (c) => {
  const {
    username,
    title_color,
    icon_color,
    hide_border,
    card_width,
    line_height,
    text_color,
    bg_color,
    theme,
    cache_seconds,
    hide_title,
    hide_progress,
    custom_title,
    locale,
    layout,
    langs_count,
    hide,
    api_domain,
    border_radius,
    border_color,
    display_format,
    disable_animations,
  } = c.req.query();

  const colors = { title_color, text_color, bg_color, border_color, theme };

  const access = guardAccess({ id: username, type: "wakatime", colors });
  if (!access.isPassed) return c.text(access.svg, 200, { "Content-Type": "image/svg+xml" });

  if (locale && !isLocaleAvailable(locale)) {
    return c.text(
      renderError({
        message: "Something went wrong",
        secondaryMessage: "Language not found",
        renderOptions: colors,
      }),
      200,
      { "Content-Type": "image/svg+xml" },
    );
  }

  try {
    const stats = await fetchWakatimeStats({ username, api_domain });
    const cacheSeconds = resolveCacheSeconds({
      requested: parseInt(cache_seconds, 10),
      def: CACHE_TTL.WAKATIME_CARD.DEFAULT,
      min: CACHE_TTL.WAKATIME_CARD.MIN,
      max: CACHE_TTL.WAKATIME_CARD.MAX,
    });
    return svgResponse(
      c,
      renderWakatimeCard(stats, {
        custom_title,
        hide_title: parseBoolean(hide_title),
        hide_border: parseBoolean(hide_border),
        card_width: parseInt(card_width, 10),
        hide: parseArray(hide),
        line_height,
        title_color,
        icon_color,
        text_color,
        bg_color,
        theme,
        hide_progress: parseBoolean(hide_progress),
        border_radius: parseFloat(border_radius),
        border_color,
        locale: locale ? locale.toLowerCase() : undefined,
        layout,
        langs_count: parseInt(langs_count, 10),
        display_format,
        disable_animations: parseBoolean(disable_animations),
      }),
      buildCacheHeaders(cacheSeconds),
    );
  } catch (err) {
    return svgError(c, err, colors, buildErrorCacheHeaders());
  }
});

// ─── /api/gist — Gist card ────────────────────────────────────────────────────
app.get("/api/gist", async (c) => {
  const {
    id,
    title_color,
    icon_color,
    text_color,
    bg_color,
    theme,
    cache_seconds,
    locale,
    border_radius,
    border_color,
    show_owner,
    hide_border,
  } = c.req.query();

  const colors = { title_color, text_color, bg_color, border_color, theme };

  const access = guardAccess({ id, type: "gist", colors });
  if (!access.isPassed) return c.text(access.svg, 200, { "Content-Type": "image/svg+xml" });

  if (locale && !isLocaleAvailable(locale)) {
    return c.text(
      renderError({
        message: "Something went wrong",
        secondaryMessage: "Language not found",
        renderOptions: colors,
      }),
      200,
      { "Content-Type": "image/svg+xml" },
    );
  }

  try {
    const gistData = await fetchGist(id);
    const cacheSeconds = resolveCacheSeconds({
      requested: parseInt(cache_seconds, 10),
      def: CACHE_TTL.GIST_CARD.DEFAULT,
      min: CACHE_TTL.GIST_CARD.MIN,
      max: CACHE_TTL.GIST_CARD.MAX,
    });
    return svgResponse(
      c,
      renderGistCard(gistData, {
        title_color,
        icon_color,
        text_color,
        bg_color,
        theme,
        border_radius: parseFloat(border_radius),
        border_color,
        locale: locale ? locale.toLowerCase() : undefined,
        show_owner: parseBoolean(show_owner),
        hide_border: parseBoolean(hide_border),
      }),
      buildCacheHeaders(cacheSeconds),
    );
  } catch (err) {
    return svgError(c, err, colors, buildErrorCacheHeaders());
  }
});

// ─── /api/status/up — Uptime check ───────────────────────────────────────────
const uptimeFetcher = (variables, token) =>
  request(
    { query: "query { rateLimit { remaining } }", variables },
    { Authorization: `bearer ${token}` },
  );

const shieldsUptimeBadge = (up) => ({
  schemaVersion: 1,
  label: "Public Instance",
  isError: true,
  message: up ? "up" : "down",
  color: up ? "brightgreen" : "red",
});

app.get("/api/status/up", async (c) => {
  let type = c.req.query("type")?.toLowerCase() ?? "boolean";

  try {
    let PATsValid = true;
    try {
      await retryer(uptimeFetcher, {});
    } catch {
      PATsValid = false;
    }

    const cacheHeader = PATsValid
      ? { "Cache-Control": `max-age=0, s-maxage=${RATE_LIMIT_SECONDS}` }
      : { "Cache-Control": "no-store" };

    switch (type) {
      case "shields":
        return c.json(shieldsUptimeBadge(PATsValid), 200, cacheHeader);
      case "json":
        return c.json({ up: PATsValid }, 200, cacheHeader);
      default:
        return c.text(String(PATsValid), 200, {
          "Content-Type": "application/json",
          ...cacheHeader,
        });
    }
  } catch (err) {
    logger.error(err);
    return c.text("Something went wrong: " + err.message, 500, {
      "Cache-Control": "no-store",
    });
  }
});

// ─── /api/status/pat-info — PAT info ─────────────────────────────────────────
const patInfoFetcher = (variables, token) =>
  request(
    {
      query: `query { rateLimit { remaining resetAt } }`,
      variables,
    },
    { Authorization: `bearer ${token}` },
  );

const getAllPATs = () => Object.keys(process.env).filter((key) => /PAT_\d*$/.exec(key));

const getPATInfo = async (fetcher, variables) => {
  const details = {};
  const PATs = getAllPATs();

  for (const pat of PATs) {
    try {
      const response = await fetcher(variables, process.env[pat]);
      const errors = response.data.errors;
      const hasErrors = Boolean(errors);
      const errorType = errors?.[0]?.type;
      const isRateLimited =
        (hasErrors && errorType === "RATE_LIMITED") ||
        response.data.data?.rateLimit?.remaining === 0;

      if (hasErrors && errorType !== "RATE_LIMITED") {
        details[pat] = {
          status: "error",
          error: { type: errors[0].type, message: errors[0].message },
        };
        continue;
      } else if (isRateLimited) {
        const date1 = new Date();
        const date2 = new Date(response.data?.data?.rateLimit?.resetAt);
        details[pat] = {
          status: "exhausted",
          remaining: 0,
          resetIn: dateDiff(date2, date1) + " minutes",
        };
      } else {
        details[pat] = {
          status: "valid",
          remaining: response.data.data.rateLimit.remaining,
        };
      }
    } catch (err) {
      const errorMessage = err.response?.data?.message?.toLowerCase();
      if (errorMessage === "bad credentials") {
        details[pat] = { status: "expired" };
      } else if (errorMessage === "sorry. your account was suspended.") {
        details[pat] = { status: "suspended" };
      } else {
        throw err;
      }
    }
  }

  const filterPATsByStatus = (status) =>
    Object.keys(details).filter((p) => details[p].status === status);

  const sortedDetails = Object.keys(details)
    .sort()
    .reduce((obj, key) => {
      obj[key] = details[key];
      return obj;
    }, {});

  return {
    validPATs: filterPATsByStatus("valid"),
    expiredPATs: filterPATsByStatus("expired"),
    exhaustedPATs: filterPATsByStatus("exhausted"),
    suspendedPATs: filterPATsByStatus("suspended"),
    errorPATs: filterPATsByStatus("error"),
    details: sortedDetails,
  };
};

app.get("/api/status/pat-info", async (c) => {
  try {
    const PATsInfo = await getPATInfo(patInfoFetcher, {});
    return c.json(PATsInfo, 200, {
      "Cache-Control": `max-age=0, s-maxage=${RATE_LIMIT_SECONDS}`,
    });
  } catch (err) {
    logger.error(err);
    return c.text("Something went wrong: " + err.message, 500, {
      "Cache-Control": "no-store",
    });
  }
});

// ─── Cache header helpers ──────────────────────────────────────────────────────

const DURATIONS_ONE_DAY = 24 * 60 * 60;

/**
 * Build Cache-Control headers as a plain object for use in hono responses.
 *
 * @param {number} cacheSeconds
 * @returns {Record<string, string>}
 */
function buildCacheHeaders(cacheSeconds) {
  if (cacheSeconds < 1 || process.env.NODE_ENV === "development") {
    return {
      "Cache-Control": "no-cache, no-store, must-revalidate, max-age=0, s-maxage=0",
      Pragma: "no-cache",
      Expires: "0",
    };
  }
  return {
    "Cache-Control": `max-age=${cacheSeconds}, s-maxage=${cacheSeconds}, stale-while-revalidate=${DURATIONS_ONE_DAY}`,
  };
}

/**
 * Build error Cache-Control headers.
 *
 * @returns {Record<string, string>}
 */
function buildErrorCacheHeaders() {
  return { "Cache-Control": `max-age=0, s-maxage=${10 * 60}` };
}

export { app, buildCacheHeaders, buildErrorCacheHeaders, getPATInfo };
export default app;
