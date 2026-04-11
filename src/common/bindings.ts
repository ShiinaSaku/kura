export type AppBindings = Record<string, string | undefined> & {
  GITHUB_TOKEN?: string;
  NODE_ENV?: string;
  WHITELIST?: string;
  GIST_WHITELIST?: string;
  EXCLUDE_REPO?: string;
  FETCH_MULTI_PAGE_STARS?: string;
  CACHE_SECONDS?: string;
};

export type HonoEnv = {
  Bindings: AppBindings;
};

function getProcessEnvValue(key: string): string | undefined {
  if (typeof process === "undefined") {
    return undefined;
  }

  const env = process.env;
  if (env === undefined || env === null) {
    return undefined;
  }

  const value = env[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function getBindingValue(bindings: AppBindings, key: string): string | undefined {
  const value = bindings[key];
  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  return getProcessEnvValue(key);
}

function getCandidateBindingKeys(bindings: AppBindings): string[] {
  const keys = new Set<string>(Object.keys(bindings));

  if (typeof process !== "undefined" && process.env !== undefined && process.env !== null) {
    for (const key of Object.keys(process.env)) {
      keys.add(key);
    }
  }

  return Array.from(keys).sort((left, right) => left.localeCompare(right));
}

export function getTokensFromBindings(bindings: AppBindings): string[] {
  const tokenByName = new Map<string, string>();

  const githubToken = getBindingValue(bindings, "GITHUB_TOKEN");
  if (githubToken !== undefined) {
    tokenByName.set("GITHUB_TOKEN", githubToken);
  }

  const bindingKeys = getCandidateBindingKeys(bindings);
  for (const key of bindingKeys) {
    if (!/^PAT_\d+$/.test(key)) {
      continue;
    }

    const value = getBindingValue(bindings, key);
    if (value !== undefined) {
      tokenByName.set(key, value);
    }
  }

  return Array.from(tokenByName.values());
}

export function getGitHubTokens(bindings: AppBindings): Array<[string, string]> {
  const tokens: Array<[string, string]> = [];

  const githubToken = getBindingValue(bindings, "GITHUB_TOKEN");
  if (githubToken !== undefined) {
    tokens.push(["GITHUB_TOKEN", githubToken]);
  }

  const bindingKeys = getCandidateBindingKeys(bindings);
  for (const key of bindingKeys) {
    if (!/^PAT_\d+$/.test(key)) {
      continue;
    }

    const value = getBindingValue(bindings, key);
    if (value !== undefined) {
      tokens.push([key, value]);
    }
  }

  return tokens;
}

export function getPrimaryGitHubToken(bindings: AppBindings): string | undefined {
  return getGitHubTokens(bindings)[0]?.[1];
}

export function parseCsvBinding(value: string | undefined): string[] {
  const fallbackValue =
    typeof value === "string" && value.length > 0 ? value : getProcessEnvValue("EXCLUDE_REPO");

  if (typeof fallbackValue !== "string" || fallbackValue.length === 0) {
    return [];
  }

  return fallbackValue
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}
