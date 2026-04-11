import { clampValue } from "./ops";

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const DURATIONS = {
  ONE_MINUTE: MINUTE,
  FIVE_MINUTES: 5 * MINUTE,
  TEN_MINUTES: 10 * MINUTE,
  FIFTEEN_MINUTES: 15 * MINUTE,
  THIRTY_MINUTES: 30 * MINUTE,
  TWO_HOURS: 2 * HOUR,
  FOUR_HOURS: 4 * HOUR,
  SIX_HOURS: 6 * HOUR,
  EIGHT_HOURS: 8 * HOUR,
  TWELVE_HOURS: 12 * HOUR,
  ONE_DAY: DAY,
  TWO_DAY: 2 * DAY,
  SIX_DAY: 6 * DAY,
  TEN_DAY: 10 * DAY,
} as const;

export const CACHE_TTL = {
  STATS_CARD: {
    DEFAULT: DURATIONS.ONE_DAY,
    MIN: DURATIONS.TWELVE_HOURS,
    MAX: DURATIONS.TWO_DAY,
  },
  TOP_LANGS_CARD: {
    DEFAULT: DURATIONS.SIX_DAY,
    MIN: DURATIONS.TWO_DAY,
    MAX: DURATIONS.TEN_DAY,
  },
  PIN_CARD: {
    DEFAULT: DURATIONS.TEN_DAY,
    MIN: DURATIONS.ONE_DAY,
    MAX: DURATIONS.TEN_DAY,
  },
  GIST_CARD: {
    DEFAULT: DURATIONS.TWO_DAY,
    MIN: DURATIONS.ONE_DAY,
    MAX: DURATIONS.TEN_DAY,
  },
  WAKATIME_CARD: {
    DEFAULT: DURATIONS.ONE_DAY,
    MIN: DURATIONS.TWELVE_HOURS,
    MAX: DURATIONS.TWO_DAY,
  },
  ERROR: DURATIONS.TEN_MINUTES,
} as const;

export type ResolveCacheSecondsArgs = {
  requested: number;
  def: number;
  min: number;
  max: number;
};

export type CacheControlOptions = {
  browserMaxAge: number;
  sharedMaxAge?: number;
  staleWhileRevalidate?: number;
  noStore?: boolean;
};

const NO_CACHE_CONTROL = "no-cache, no-store, must-revalidate, max-age=0, s-maxage=0";

export function resolveCacheSeconds({ requested, def, min, max }: ResolveCacheSecondsArgs): number {
  const normalized = Number.isNaN(requested) ? def : requested;
  return clampValue(normalized, min, max);
}

export function mergeHeaders(...headersList: HeadersInit[]): Headers {
  const merged = new Headers();

  for (const headers of headersList) {
    const current = new Headers(headers);
    current.forEach((value, key) => {
      merged.set(key, value);
    });
  }

  return merged;
}

export function createNoCacheHeaders(): Headers {
  return mergeHeaders({
    "Cache-Control": NO_CACHE_CONTROL,
    Pragma: "no-cache",
    Expires: "0",
  });
}

export function createCacheHeaders({
  browserMaxAge,
  sharedMaxAge = browserMaxAge,
  staleWhileRevalidate = DURATIONS.ONE_DAY,
  noStore = false,
}: CacheControlOptions): Headers {
  if (noStore || (browserMaxAge < 1 && sharedMaxAge < 1)) {
    return createNoCacheHeaders();
  }

  const directives = [
    `max-age=${browserMaxAge}`,
    `s-maxage=${sharedMaxAge}`,
    `stale-while-revalidate=${staleWhileRevalidate}`,
  ];

  return mergeHeaders({ "Cache-Control": directives.join(", ") });
}

export function createCardCacheHeaders(cacheSeconds: number): Headers {
  return createCacheHeaders({
    browserMaxAge: cacheSeconds,
    sharedMaxAge: cacheSeconds,
    staleWhileRevalidate: DURATIONS.ONE_DAY,
  });
}

export function createErrorCacheHeaders(): Headers {
  return createCacheHeaders({
    browserMaxAge: 0,
    sharedMaxAge: CACHE_TTL.ERROR,
    staleWhileRevalidate: DURATIONS.ONE_DAY,
  });
}

export function createEntityTag(payload: string): string {
  let hash = 2166136261;

  for (let index = 0; index < payload.length; index += 1) {
    hash ^= payload.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  const normalized = (hash >>> 0).toString(16).padStart(8, "0");
  return `W/"${normalized}-${payload.length}"`;
}

export function withHeaders(response: Response, headers: HeadersInit): Response {
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: mergeHeaders(response.headers, headers),
  });
}

export function applyConditionalRequest(request: Request, response: Response): Response {
  const etag = response.headers.get("ETag");
  const ifNoneMatch = request.headers.get("If-None-Match");

  if (etag !== null && ifNoneMatch === etag) {
    const headers = mergeHeaders(response.headers);
    return new Response(null, { status: 304, headers });
  }

  return response;
}
