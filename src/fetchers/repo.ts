import { MissingParamError } from "../common/error";
import type { GraphqlEnvelope, GraphqlError, RetryingGitHubClient } from "../common/github.js";
import type { RepositoryData } from "./types";

type RepositoryQueryVariables = {
  login: string;
  repo: string;
};

type RepositoryNode = {
  name: string;
  nameWithOwner: string;
  isPrivate: boolean;
  isArchived: boolean;
  isTemplate: boolean;
  stargazers: {
    totalCount: number;
  };
  description: string | null;
  primaryLanguage: {
    color: string | null;
    id: string;
    name: string;
  } | null;
  forkCount: number;
};

type RepositoryQueryData = {
  user: {
    repository: RepositoryNode | null;
  } | null;
  organization: {
    repository: RepositoryNode | null;
  } | null;
};

const urlExample = "/api/pin?username=USERNAME&amp;repo=REPO_NAME";

const REPOSITORY_QUERY = `
  fragment RepoInfo on Repository {
    name
    nameWithOwner
    isPrivate
    isArchived
    isTemplate
    stargazers {
      totalCount
    }
    description
    primaryLanguage {
      color
      id
      name
    }
    forkCount
  }
  query getRepo($login: String!, $repo: String!) {
    user(login: $login) {
      repository(name: $repo) {
        ...RepoInfo
      }
    }
    organization(login: $login) {
      repository(name: $repo) {
        ...RepoInfo
      }
    }
  }
`;

function getFirstErrorMessage(errors: GraphqlError[] | undefined): string {
  return errors?.[0]?.message ?? "Not found";
}

function normalizeRepository(repository: RepositoryNode): RepositoryData {
  return {
    ...repository,
    description: repository.description ?? "",
    primaryLanguage:
      repository.primaryLanguage === null
        ? null
        : {
            color: repository.primaryLanguage.color ?? "#333",
            id: repository.primaryLanguage.id,
            name: repository.primaryLanguage.name,
          },
    starCount: repository.stargazers.totalCount,
  };
}

export async function fetchRepo(
  username: string | undefined,
  reponame: string | undefined,
  client: RetryingGitHubClient,
): Promise<RepositoryData> {
  if (username === undefined && reponame === undefined) {
    throw new MissingParamError(["username", "repo"], urlExample);
  }
  if (username === undefined) {
    throw new MissingParamError(["username"], urlExample);
  }
  if (reponame === undefined) {
    throw new MissingParamError(["repo"], urlExample);
  }

  const payload = await client.graphql<RepositoryQueryData, RepositoryQueryVariables>({
    query: REPOSITORY_QUERY,
    variables: {
      login: username,
      repo: reponame,
    },
  });

  if (payload.errors !== undefined && payload.errors.length > 0) {
    throw new Error(getFirstErrorMessage(payload.errors));
  }

  const data = payload.data;
  if (data === undefined) {
    throw new Error("Not found");
  }

  if (data.user !== null && data.user.repository !== null) {
    if (data.user.repository.isPrivate) {
      throw new Error("User Repository Not found");
    }

    return normalizeRepository(data.user.repository);
  }

  if (data.organization !== null && data.organization.repository !== null) {
    if (data.organization.repository.isPrivate) {
      throw new Error("Organization Repository Not found");
    }

    return normalizeRepository(data.organization.repository);
  }

  throw new Error("Not found");
}

export default fetchRepo;
