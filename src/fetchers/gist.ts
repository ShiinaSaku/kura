import { MissingParamError } from "../common/error";
import type { GraphqlEnvelope, RetryingGitHubClient } from "../common/github.js";
import type { GistData } from "./types";

type GistFile = {
  name: string;
  language: {
    name: string;
  } | null;
  size: number;
};

type GistQueryData = {
  viewer: {
    gist: {
      description: string | null;
      owner: {
        login: string;
      };
      stargazerCount: number;
      forks: {
        totalCount: number;
      };
      files: GistFile[];
    } | null;
  };
};

type GistQueryVariables = {
  gistName: string;
};

const QUERY = `
query gistInfo($gistName: String!) {
  viewer {
    gist(name: $gistName) {
      description
      owner {
        login
      }
      stargazerCount
      forks {
        totalCount
      }
      files {
        name
        language {
          name
        }
        size
      }
    }
  }
}
`;

function calculatePrimaryLanguage(files: GistFile[]): string | null {
  const languageSizes = new Map<string, number>();

  for (const file of files) {
    if (file.language === null) {
      continue;
    }

    languageSizes.set(file.language.name, (languageSizes.get(file.language.name) ?? 0) + file.size);
  }

  let primaryLanguage: string | null = null;
  let largestSize = -1;

  for (const [language, size] of languageSizes.entries()) {
    if (size > largestSize) {
      primaryLanguage = language;
      largestSize = size;
    }
  }

  return primaryLanguage;
}

function assertGistPayload(payload: GraphqlEnvelope<GistQueryData>) {
  if (payload.errors !== undefined && payload.errors.length > 0) {
    throw new Error(payload.errors[0]?.message ?? "Gist not found");
  }

  const gist = payload.data?.viewer.gist;
  if (gist === null || gist === undefined) {
    throw new Error("Gist not found");
  }

  return gist;
}

export async function fetchGist(
  id: string | undefined,
  client: RetryingGitHubClient,
): Promise<GistData> {
  if (id === undefined || id.length === 0) {
    throw new MissingParamError(["id"], "/api/gist?id=GIST_ID");
  }

  const payload = await client.graphql<GistQueryData, GistQueryVariables>({
    query: QUERY,
    variables: { gistName: id },
  });

  const gist = assertGistPayload(payload);
  const primaryFile = gist.files[0];

  return {
    name: primaryFile?.name ?? "Unknown",
    nameWithOwner: `${gist.owner.login}/${primaryFile?.name ?? "Unknown"}`,
    description: gist.description,
    language: calculatePrimaryLanguage(gist.files),
    starsCount: gist.stargazerCount,
    forksCount: gist.forks.totalCount,
  };
}

export default fetchGist;
