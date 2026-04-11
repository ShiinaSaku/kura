import githubUsernameRegex from "github-username-regex";
import { calculateRank } from "../calculateRank.js";
import { CustomError, MissingParamError } from "../common/error";
import { wrapTextMultiline } from "../common/fmt";
import type { GraphqlEnvelope, GraphqlError, RetryingGitHubClient } from "../common/github.js";
import type { StatsData } from "./types";

type StatsRepositoryNode = {
  name: string;
  stargazers: {
    totalCount: number;
  };
};

type StatsRepositoriesConnection = {
  totalCount: number;
  nodes: StatsRepositoryNode[];
  pageInfo: {
    hasNextPage: boolean;
    endCursor: string | null;
  };
};

type CountNode = {
  totalCount: number;
};

type CommitContributions = {
  totalCommitContributions: number;
};

type ReviewContributions = {
  totalPullRequestReviewContributions: number;
};

type StatsUser = {
  name: string | null;
  login: string;
  commits: CommitContributions;
  reviews: ReviewContributions;
  repositoriesContributedTo: CountNode;
  pullRequests: CountNode;
  mergedPullRequests?: CountNode;
  openIssues: CountNode;
  closedIssues: CountNode;
  followers: CountNode;
  repositoryDiscussions?: CountNode;
  repositoryDiscussionComments?: CountNode;
  repositories: StatsRepositoriesConnection;
};

type StatsQueryData = {
  user: StatsUser | null;
};

type TotalCommitsResponse = {
  total_count: number;
};

export type FetchStatsOptions = {
  includeAllCommits?: boolean | undefined;
  excludeRepositories?: string[] | undefined;
  defaultExcludeRepositories?: string[] | undefined;
  includeMergedPullRequests?: boolean | undefined;
  includeDiscussions?: boolean | undefined;
  includeDiscussionsAnswers?: boolean | undefined;
  commitsYear?: number | undefined;
  fetchMultiPageStars?: boolean | undefined;
};

type StatsFetcherVariables = {
  login: string;
  after: string | null;
  includeMergedPullRequests: boolean;
  includeDiscussions: boolean;
  includeDiscussionsAnswers: boolean;
  startTime?: string;
};

const GRAPHQL_REPOS_FIELD = `
  repositories(first: 100, ownerAffiliations: OWNER, orderBy: {direction: DESC, field: STARGAZERS}, after: $after) {
    totalCount
    nodes {
      name
      stargazers {
        totalCount
      }
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
`;

const GRAPHQL_REPOS_QUERY = `
  query userInfo($login: String!, $after: String) {
    user(login: $login) {
      ${GRAPHQL_REPOS_FIELD}
    }
  }
`;

const GRAPHQL_STATS_QUERY = `
  query userInfo($login: String!, $after: String, $includeMergedPullRequests: Boolean!, $includeDiscussions: Boolean!, $includeDiscussionsAnswers: Boolean!, $startTime: DateTime = null) {
    user(login: $login) {
      name
      login
      commits: contributionsCollection (from: $startTime) {
        totalCommitContributions
      }
      reviews: contributionsCollection {
        totalPullRequestReviewContributions
      }
      repositoriesContributedTo(first: 1, contributionTypes: [COMMIT, ISSUE, PULL_REQUEST, REPOSITORY]) {
        totalCount
      }
      pullRequests(first: 1) {
        totalCount
      }
      mergedPullRequests: pullRequests(states: MERGED) @include(if: $includeMergedPullRequests) {
        totalCount
      }
      openIssues: issues(states: OPEN) {
        totalCount
      }
      closedIssues: issues(states: CLOSED) {
        totalCount
      }
      followers {
        totalCount
      }
      repositoryDiscussions @include(if: $includeDiscussions) {
        totalCount
      }
      repositoryDiscussionComments(onlyAnswers: true) @include(if: $includeDiscussionsAnswers) {
        totalCount
      }
      ${GRAPHQL_REPOS_FIELD}
    }
  }
`;

function getGraphqlErrorType(error: GraphqlError | undefined): string {
  return typeof error?.type === "string" ? error.type : CustomError.GRAPHQL_ERROR;
}

function createGraphqlError(errors: GraphqlError[] | undefined) {
  const firstError = errors?.[0];

  if (firstError?.type === "NOT_FOUND") {
    return new CustomError(
      firstError.message || "Could not fetch user.",
      CustomError.USER_NOT_FOUND,
    );
  }

  if (typeof firstError?.message === "string" && firstError.message.length > 0) {
    return new CustomError(
      wrapTextMultiline(firstError.message, 90, 1)[0],
      getGraphqlErrorType(firstError),
    );
  }

  return new CustomError(
    "Something went wrong while trying to retrieve the stats data using the GraphQL API.",
    CustomError.GRAPHQL_ERROR,
  );
}

function assertStatsPayload(payload: GraphqlEnvelope<StatsQueryData>): StatsUser {
  if (payload.errors !== undefined && payload.errors.length > 0) {
    throw createGraphqlError(payload.errors);
  }

  const user = payload.data?.user;
  if (user === null || user === undefined) {
    throw new CustomError("Could not fetch user.", CustomError.USER_NOT_FOUND);
  }

  return user;
}

async function fetchStatsPage(
  client: RetryingGitHubClient,
  variables: StatsFetcherVariables,
): Promise<GraphqlEnvelope<StatsQueryData>> {
  const query = variables.after === null ? GRAPHQL_STATS_QUERY : GRAPHQL_REPOS_QUERY;
  return client.graphql<StatsQueryData, StatsFetcherVariables>({
    query,
    variables,
  });
}

async function fetchStatsPages(
  client: RetryingGitHubClient,
  variables: Omit<StatsFetcherVariables, "after">,
  fetchMultiPageStars: boolean,
): Promise<GraphqlEnvelope<StatsQueryData>> {
  let aggregatedPayload: GraphqlEnvelope<StatsQueryData> | undefined;
  let after: string | null = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const payload = await fetchStatsPage(client, {
      ...variables,
      after,
    });

    if (payload.errors !== undefined && payload.errors.length > 0) {
      return payload;
    }

    const user = assertStatsPayload(payload);
    const repoNodes = user.repositories.nodes;

    if (aggregatedPayload === undefined) {
      aggregatedPayload = payload;
    } else {
      const aggregatedUser = assertStatsPayload(aggregatedPayload);
      aggregatedUser.repositories.nodes.push(...repoNodes);
      aggregatedUser.repositories.pageInfo = user.repositories.pageInfo;
    }

    const repoNodesWithStars = repoNodes.filter((node) => node.stargazers.totalCount !== 0);
    hasNextPage =
      fetchMultiPageStars &&
      repoNodes.length === repoNodesWithStars.length &&
      user.repositories.pageInfo.hasNextPage;
    after = user.repositories.pageInfo.endCursor;
  }

  return aggregatedPayload ?? { data: { user: null } };
}

async function fetchTotalCommits(username: string, client: RetryingGitHubClient): Promise<number> {
  if (!githubUsernameRegex.test(username)) {
    throw new Error("Invalid username provided.");
  }

  const response = await client.rest<TotalCommitsResponse>(
    `/search/commits?q=author:${encodeURIComponent(username)}`,
    {
      method: "GET",
      headers: {
        Accept: "application/vnd.github.cloak-preview+json",
      },
    },
  );

  if (!Number.isFinite(response.total_count) || response.total_count <= 0) {
    throw new CustomError("Could not fetch total commits.", CustomError.GITHUB_REST_API_ERROR);
  }

  return response.total_count;
}

export async function fetchStats(
  username: string | undefined,
  options: FetchStatsOptions,
  client: RetryingGitHubClient,
): Promise<StatsData> {
  if (username === undefined || username.length === 0) {
    throw new MissingParamError(["username"]);
  }

  const {
    includeAllCommits = false,
    excludeRepositories = [],
    defaultExcludeRepositories = [],
    includeMergedPullRequests = false,
    includeDiscussions = false,
    includeDiscussionsAnswers = false,
    commitsYear,
    fetchMultiPageStars = false,
  } = options;

  const normalizedCommitsYear =
    typeof commitsYear === "number" && Number.isInteger(commitsYear) && commitsYear > 0
      ? commitsYear
      : undefined;

  const payload = await fetchStatsPages(
    client,
    {
      login: username,
      includeMergedPullRequests,
      includeDiscussions,
      includeDiscussionsAnswers,
      ...(normalizedCommitsYear === undefined
        ? {}
        : { startTime: `${normalizedCommitsYear}-01-01T00:00:00Z` }),
    },
    fetchMultiPageStars,
  );

  const user = assertStatsPayload(payload);

  const stats: StatsData = {
    name: user.name ?? user.login,
    totalPRs: user.pullRequests.totalCount,
    totalPRsMerged: includeMergedPullRequests ? (user.mergedPullRequests?.totalCount ?? 0) : 0,
    mergedPRsPercentage:
      includeMergedPullRequests && user.pullRequests.totalCount > 0
        ? ((user.mergedPullRequests?.totalCount ?? 0) / user.pullRequests.totalCount) * 100
        : 0,
    totalReviews: user.reviews.totalPullRequestReviewContributions,
    totalCommits: includeAllCommits
      ? await fetchTotalCommits(username, client)
      : user.commits.totalCommitContributions,
    totalIssues: user.openIssues.totalCount + user.closedIssues.totalCount,
    totalStars: 0,
    totalDiscussionsStarted: includeDiscussions ? (user.repositoryDiscussions?.totalCount ?? 0) : 0,
    totalDiscussionsAnswered: includeDiscussionsAnswers
      ? (user.repositoryDiscussionComments?.totalCount ?? 0)
      : 0,
    contributedTo: user.repositoriesContributedTo.totalCount,
    rank: { level: "C", percentile: 100 },
  };

  const repoToHide = new Set([...excludeRepositories, ...defaultExcludeRepositories]);

  stats.totalStars = user.repositories.nodes
    .filter((repository) => !repoToHide.has(repository.name))
    .reduce((totalStars, repository) => totalStars + repository.stargazers.totalCount, 0);

  stats.rank = calculateRank({
    all_commits: includeAllCommits,
    commits: stats.totalCommits,
    prs: stats.totalPRs,
    reviews: stats.totalReviews,
    issues: stats.totalIssues,
    repos: user.repositories.totalCount,
    stars: stats.totalStars,
    followers: user.followers.totalCount,
  });

  return stats;
}

export default fetchStats;
