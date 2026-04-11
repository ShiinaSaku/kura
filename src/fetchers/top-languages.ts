import { CustomError, MissingParamError } from "../common/error";
import { wrapTextMultiline } from "../common/fmt";
import type { GraphqlEnvelope, GraphqlError, RetryingGitHubClient } from "../common/github.js";
import type { Lang, TopLangData } from "./types";

type LanguageNode = {
  color: string | null;
  name: string;
};

type LanguageEdge = {
  size: number;
  node: LanguageNode;
};

type RepositoryNode = {
  name: string;
  languages: {
    edges: LanguageEdge[];
  };
};

type TopLanguagesQueryData = {
  user: {
    repositories: {
      nodes: RepositoryNode[];
    };
  } | null;
};

type TopLanguagesQueryVariables = {
  login: string;
};

type AggregatedLanguage = Lang & {
  count: number;
};

export type FetchTopLanguagesOptions = {
  excludeRepositories?: string[];
  defaultExcludeRepositories?: string[];
  hiddenLanguages?: string[];
  sizeWeight?: number;
  countWeight?: number;
};

const normalizeWeight = (value: number | undefined, fallback: number): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return value;
};

const TOP_LANGUAGES_QUERY = `
  query userInfo($login: String!) {
    user(login: $login) {
      repositories(ownerAffiliations: OWNER, isFork: false, first: 100) {
        nodes {
          name
          languages(first: 10, orderBy: {field: SIZE, direction: DESC}) {
            edges {
              size
              node {
                color
                name
              }
            }
          }
        }
      }
    }
  }
`;

function createGraphqlError(errors: GraphqlError[] | undefined): CustomError {
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
      typeof firstError.type === "string" ? firstError.type : CustomError.GRAPHQL_ERROR,
    );
  }

  return new CustomError(
    "Something went wrong while trying to retrieve the language data using the GraphQL API.",
    CustomError.GRAPHQL_ERROR,
  );
}

function assertTopLanguagesPayload(
  payload: GraphqlEnvelope<TopLanguagesQueryData>,
): RepositoryNode[] {
  if (payload.errors !== undefined && payload.errors.length > 0) {
    throw createGraphqlError(payload.errors);
  }

  const repositories = payload.data?.user?.repositories.nodes;
  if (repositories === undefined) {
    throw new CustomError("Could not fetch user.", CustomError.USER_NOT_FOUND);
  }

  return repositories;
}

function aggregateLanguages(
  repositories: RepositoryNode[],
  options: Required<
    Pick<
      FetchTopLanguagesOptions,
      | "excludeRepositories"
      | "defaultExcludeRepositories"
      | "hiddenLanguages"
      | "sizeWeight"
      | "countWeight"
    >
  >,
): TopLangData {
  const hiddenRepositories = new Set([
    ...options.excludeRepositories,
    ...options.defaultExcludeRepositories,
  ]);
  const hiddenLanguages = new Set(
    options.hiddenLanguages.map((language) => language.toLowerCase()),
  );

  const aggregated = repositories
    .filter((repository) => !hiddenRepositories.has(repository.name))
    .filter((repository) => repository.languages.edges.length > 0)
    .flatMap((repository) => repository.languages.edges)
    .reduce<Record<string, AggregatedLanguage>>((accumulator, edge) => {
      const languageName = edge.node.name;
      if (hiddenLanguages.has(languageName.toLowerCase())) {
        return accumulator;
      }

      const existing = accumulator[languageName];
      if (existing !== undefined) {
        existing.size += edge.size;
        existing.count += 1;
        return accumulator;
      }

      accumulator[languageName] = {
        name: languageName,
        color: edge.node.color ?? "#858585",
        size: edge.size,
        count: 1,
      };
      return accumulator;
    }, {});

  Object.values(aggregated).forEach((language) => {
    language.size =
      Math.pow(language.size, options.sizeWeight) * Math.pow(language.count, options.countWeight);
  });

  return Object.values(aggregated)
    .sort((left, right) => right.size - left.size)
    .reduce<TopLangData>((result, language) => {
      result[language.name] = {
        name: language.name,
        color: language.color,
        size: language.size,
      };
      return result;
    }, {});
}

export async function fetchTopLanguages(
  username: string | undefined,
  options: FetchTopLanguagesOptions,
  client: RetryingGitHubClient,
): Promise<TopLangData> {
  if (username === undefined || username.length === 0) {
    throw new MissingParamError(["username"]);
  }

  const payload = await client.graphql<TopLanguagesQueryData, TopLanguagesQueryVariables>({
    query: TOP_LANGUAGES_QUERY,
    variables: { login: username },
  });

  const repositories = assertTopLanguagesPayload(payload);

  return aggregateLanguages(repositories, {
    excludeRepositories: options.excludeRepositories ?? [],
    defaultExcludeRepositories: options.defaultExcludeRepositories ?? [],
    hiddenLanguages: options.hiddenLanguages ?? [],
    sizeWeight: normalizeWeight(options.sizeWeight, 1),
    countWeight: normalizeWeight(options.countWeight, 0),
  });
}

export default fetchTopLanguages;
