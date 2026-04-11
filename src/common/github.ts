import {
  getGitHubTokens,
  getPrimaryGitHubToken,
  getTokensFromBindings,
  type AppBindings,
} from "./bindings.js";

const GITHUB_GRAPHQL_URL = "https://api.github.com/graphql";
const GITHUB_REST_URL = "https://api.github.com";

type Primitive = string | number | boolean | null;

export type GraphqlVariables = Record<
  string,
  Primitive | Primitive[] | GraphqlVariables | undefined
>;

export type GraphqlError = {
  type?: string;
  message?: string;
  path?: Array<string | number>;
};

export type GraphqlEnvelope<TData> = {
  data?: TData;
  errors?: GraphqlError[];
};

export type GitHubClientOptions = {
  token: string;
  fetchImpl?: typeof fetch;
  userAgent?: string;
};

export type GitHubRetryOptions = {
  tokens: string[];
  fetchImpl?: typeof fetch;
  userAgent?: string;
  maxAttemptsPerToken?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
};

export type RetryingGitHubClient = {
  rest<TResponse>(path: string, init?: RequestInit): Promise<TResponse>;
  graphql<TData, TVariables extends GraphqlVariables = GraphqlVariables>(args: {
    query: string;
    variables?: TVariables;
    signal?: AbortSignal;
  }): Promise<GraphqlEnvelope<TData>>;
};

type RetryRequestInit = RequestInit & {
  signal?: AbortSignal;
};

type GraphqlRequest<TVariables extends GraphqlVariables> = {
  query: string;
  variables?: TVariables;
  signal?: AbortSignal;
};

type RequestExecutor<TResponse> = (token: string) => Promise<TResponse>;

type TokenAttemptFailure = {
  tokenIndex: number;
  attempt: number;
  error: unknown;
};

export class GitHubApiError extends Error {
  readonly status: number;
  readonly url: string;
  readonly payload: unknown;
  readonly headers: Headers;

  constructor(
    message: string,
    options: { status: number; url: string; payload: unknown; headers?: Headers },
  ) {
    super(message);
    this.name = "GitHubApiError";
    this.status = options.status;
    this.url = options.url;
    this.payload = options.payload;
    this.headers = options.headers ?? new Headers();
  }
}

export class GitHubRetryLimitError extends Error {
  readonly failures: TokenAttemptFailure[];

  constructor(message: string, failures: TokenAttemptFailure[]) {
    super(message);
    this.name = "GitHubRetryLimitError";
    this.failures = failures;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    return response.json();
  }

  const text = await response.text();
  return text.length === 0 ? null : text;
}

function buildHeaders(token: string, userAgent: string | undefined, init?: HeadersInit): Headers {
  const headers = new Headers(init);
  headers.set("Authorization", `Bearer ${token}`);

  if (!headers.has("Accept")) {
    headers.set("Accept", "application/vnd.github+json");
  }

  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  if (userAgent !== undefined && userAgent.length > 0) {
    headers.set("User-Agent", userAgent);
  }

  return headers;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function clampDelay(value: number, maxDelayMs: number): number {
  return Math.min(Math.max(0, value), maxDelayMs);
}

function getRetryAfterMilliseconds(headers: Headers): number | undefined {
  const retryAfter = headers.get("retry-after");

  if (retryAfter !== null) {
    const seconds = Number.parseInt(retryAfter, 10);
    if (!Number.isNaN(seconds)) {
      return seconds * 1000;
    }

    const retryAt = Date.parse(retryAfter);
    if (!Number.isNaN(retryAt)) {
      return Math.max(0, retryAt - Date.now());
    }
  }

  const resetAt = headers.get("x-ratelimit-reset");
  if (resetAt !== null) {
    const epochSeconds = Number.parseInt(resetAt, 10);
    if (!Number.isNaN(epochSeconds)) {
      return Math.max(0, epochSeconds * 1000 - Date.now());
    }
  }

  return undefined;
}

function isRateLimitPayload(payload: unknown): boolean {
  if (!isObject(payload)) {
    return false;
  }

  const message = typeof payload.message === "string" ? payload.message : "";
  const errors = Array.isArray(payload.errors) ? payload.errors : [];
  const firstError = errors[0];

  if (isObject(firstError) && firstError.type === "RATE_LIMITED") {
    return true;
  }

  return /rate limit/i.test(message) || /rate limit/i.test(JSON.stringify(errors));
}

function isCredentialFailure(payload: unknown): boolean {
  if (!isObject(payload) || typeof payload.message !== "string") {
    return false;
  }

  return (
    payload.message === "Bad credentials" ||
    payload.message === "Sorry. Your account was suspended."
  );
}

function isRetryableStatus(status: number): boolean {
  return (
    status === 403 ||
    status === 408 ||
    status === 409 ||
    status === 425 ||
    status === 429 ||
    status >= 500
  );
}

function getBackoffMilliseconds(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  const exponential = baseDelayMs * 2 ** Math.max(0, attempt - 1);
  const jitter = Math.floor(Math.random() * baseDelayMs);
  return clampDelay(exponential + jitter, maxDelayMs);
}

async function executeWithTokenRotation<TResponse>(
  executor: RequestExecutor<TResponse>,
  {
    tokens,
    baseDelayMs,
    maxDelayMs,
    maxAttemptsPerToken,
  }: Required<
    Pick<GitHubRetryOptions, "tokens" | "baseDelayMs" | "maxDelayMs" | "maxAttemptsPerToken">
  >,
): Promise<TResponse> {
  if (tokens.length === 0) {
    throw new GitHubRetryLimitError("Missing GITHUB_TOKEN or PAT_* binding", []);
  }

  const failures: TokenAttemptFailure[] = [];

  for (const [tokenIndex, token] of tokens.entries()) {
    for (let attempt = 1; attempt <= maxAttemptsPerToken; attempt += 1) {
      try {
        return await executor(token);
      } catch (error) {
        failures.push({ tokenIndex, attempt, error });

        if (error instanceof GitHubApiError) {
          const payload = error.payload;

          if (isCredentialFailure(payload) || isRateLimitPayload(payload)) {
            break;
          }

          if (!isRetryableStatus(error.status)) {
            throw error;
          }
        }

        if (attempt === maxAttemptsPerToken) {
          break;
        }

        const retryAfterMs =
          error instanceof GitHubApiError ? getRetryAfterMilliseconds(error.headers) : undefined;
        const delayMs = retryAfterMs ?? getBackoffMilliseconds(attempt, baseDelayMs, maxDelayMs);
        await sleep(delayMs);
      }
    }
  }

  const lastFailure = failures.at(-1)?.error;
  if (lastFailure instanceof Error) {
    throw new GitHubRetryLimitError(lastFailure.message, failures);
  }

  throw new GitHubRetryLimitError(
    "GitHub request failed after exhausting all configured tokens",
    failures,
  );
}

export function createGitHubClient({
  token,
  fetchImpl = fetch,
  userAgent = "kura",
}: GitHubClientOptions) {
  async function rest<TResponse>(path: string, init: RetryRequestInit = {}): Promise<TResponse> {
    const url = path.startsWith("http") ? path : `${GITHUB_REST_URL}${path}`;
    const response = await fetchImpl(url, {
      ...init,
      headers: buildHeaders(token, userAgent, init.headers),
    });

    const payload = await parseResponseBody(response);

    if (!response.ok) {
      const message =
        isObject(payload) && typeof payload.message === "string"
          ? payload.message
          : `GitHub REST request failed with ${response.status}`;
      throw new GitHubApiError(message, {
        status: response.status,
        url,
        payload,
        headers: response.headers,
      });
    }

    return payload as TResponse;
  }

  async function graphql<TData, TVariables extends GraphqlVariables = GraphqlVariables>(
    args: GraphqlRequest<TVariables>,
  ): Promise<GraphqlEnvelope<TData>> {
    const response = await fetchImpl(GITHUB_GRAPHQL_URL, {
      method: "POST",
      headers: buildHeaders(token, userAgent),
      body: JSON.stringify({
        query: args.query,
        variables: args.variables ?? {},
      }),
      signal: args.signal,
    });

    const payload = await parseResponseBody(response);

    if (!response.ok) {
      const message =
        isObject(payload) && typeof payload.message === "string"
          ? payload.message
          : `GitHub GraphQL request failed with ${response.status}`;
      throw new GitHubApiError(message, {
        status: response.status,
        url: GITHUB_GRAPHQL_URL,
        payload,
        headers: response.headers,
      });
    }

    return payload as GraphqlEnvelope<TData>;
  }

  return {
    rest,
    graphql,
  };
}

export function createRetryingGitHubClient({
  tokens,
  fetchImpl = fetch,
  userAgent = "kura",
  maxAttemptsPerToken = 2,
  baseDelayMs = 250,
  maxDelayMs = 2_000,
}: GitHubRetryOptions) {
  const normalizedTokens = tokens.filter((token) => token.length > 0);

  return {
    async rest<TResponse>(path: string, init: RetryRequestInit = {}): Promise<TResponse> {
      return executeWithTokenRotation(
        async (token) => {
          const client = createGitHubClient({ token, fetchImpl, userAgent });
          return client.rest<TResponse>(path, init);
        },
        {
          tokens: normalizedTokens,
          maxAttemptsPerToken,
          baseDelayMs,
          maxDelayMs,
        },
      );
    },

    async graphql<TData, TVariables extends GraphqlVariables = GraphqlVariables>(
      args: GraphqlRequest<TVariables>,
    ): Promise<GraphqlEnvelope<TData>> {
      return executeWithTokenRotation(
        async (token) => {
          const client = createGitHubClient({ token, fetchImpl, userAgent });
          const payload = await client.graphql<TData, TVariables>(args);

          if (isRateLimitPayload(payload)) {
            throw new GitHubApiError("GitHub GraphQL rate limit exceeded", {
              status: 429,
              url: GITHUB_GRAPHQL_URL,
              payload,
            });
          }

          return payload;
        },
        {
          tokens: normalizedTokens,
          maxAttemptsPerToken,
          baseDelayMs,
          maxDelayMs,
        },
      );
    },
  };
}

export function createGitHubClientFromBindings(
  bindings: AppBindings,
  options: Omit<GitHubClientOptions, "token"> = {},
) {
  const token = getPrimaryGitHubToken(bindings);

  if (token === undefined) {
    throw new Error("Missing GITHUB_TOKEN or PAT_* binding");
  }

  return createGitHubClient({
    ...options,
    token,
  });
}

export function createRetryingGitHubClientFromBindings(
  bindings: AppBindings,
  options: Omit<GitHubRetryOptions, "tokens"> = {},
) {
  const tokens = getTokensFromBindings(bindings);

  return createRetryingGitHubClient({
    ...options,
    tokens,
  });
}
