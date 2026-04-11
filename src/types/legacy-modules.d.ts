type QueryColors = {
  title_color?: string;
  text_color?: string;
  bg_color?: string;
  border_color?: string;
  theme?: string;
};

type RenderErrorOptions = QueryColors & {
  show_repo_link?: boolean;
};

type AccessResult = { isPassed: true } | { isPassed: false; svg: string };

type GraphqlError = {
  type?: string;
  message?: string;
};

declare module "emoji-name-map" {
  const emojiNameMap: {
    get(name: string): string | undefined;
  };
  export default emojiNameMap;
}

declare module "word-wrap" {
  interface WrapOptions {
    width?: number;
    indent?: string;
    newline?: string;
    trim?: boolean;
    cut?: boolean;
  }
  const wrap: (str: string, options?: WrapOptions) => string;
  export default wrap;
}

declare module "module" {
  export function createRequire(path: string): (id: string) => unknown;
}

declare module "./src/fetchers/repo.js" {
  export function fetchRepo(
    username: string | undefined,
    repo: string | undefined,
    client: import("./src/common/github.js").RetryingGitHubClient,
  ): Promise<import("./src/fetchers/types").RepositoryData>;
}

declare module "./src/fetchers/stats.js" {
  export type FetchStatsOptions = {
    includeAllCommits?: boolean;
    excludeRepositories?: string[];
    defaultExcludeRepositories?: string[];
    includeMergedPullRequests?: boolean;
    includeDiscussions?: boolean;
    includeDiscussionsAnswers?: boolean;
    commitsYear?: number;
    fetchMultiPageStars?: boolean;
  };

  export function fetchStats(
    username: string | undefined,
    options: FetchStatsOptions,
    client: import("./src/common/github.js").RetryingGitHubClient,
  ): Promise<import("./src/fetchers/types").StatsData>;
}

declare module "./src/fetchers/top-languages.js" {
  export type FetchTopLanguagesOptions = {
    excludeRepositories?: string[];
    defaultExcludeRepositories?: string[];
    hiddenLanguages?: string[];
    sizeWeight?: number;
    countWeight?: number;
  };

  export function fetchTopLanguages(
    username: string | undefined,
    options: FetchTopLanguagesOptions,
    client: import("./src/common/github.js").RetryingGitHubClient,
  ): Promise<import("./src/fetchers/types").TopLangData>;
}

declare module "./src/fetchers/wakatime.js" {
  export type FetchWakatimeStatsOptions = {
    username: string | undefined;
    apiDomain?: string;
    fetchImpl?: typeof fetch;
  };

  export function fetchWakatimeStats(
    options: FetchWakatimeStatsOptions,
  ): Promise<import("./src/fetchers/types").WakaTimeData>;
}

declare module "./src/fetchers/gist.js" {
  export function fetchGist(
    id: string | undefined,
    client: import("./src/common/github.js").RetryingGitHubClient,
  ): Promise<import("./src/fetchers/types").GistData>;
}

declare module "./src/fetchers/repo.js" {
  export function fetchRepo(
    username?: string | undefined,
    repo?: string | undefined,
    client: import("./src/common/github.js").RetryingGitHubClient,
  ): Promise<import("./src/fetchers/types").RepositoryData>;
}

declare module "./src/translations.js" {
  export function isLocaleAvailable(locale: string): boolean;
}

declare module "*.js";

declare module "github-username-regex" {
  const githubUsernameRegex: RegExp;
  export default githubUsernameRegex;
}
