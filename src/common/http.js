// @ts-check

import { $fetch, FetchError } from "ofetch";

const GITHUB_GRAPHQL_URL = "https://api.github.com/graphql";

/**
 * Send GraphQL request to GitHub API.
 *
 * Returns `{ data }` to remain compatible with the existing response shape used
 * throughout the fetchers (previously provided by axios).
 *
 * @param {Record<string, unknown>} data Request body (GraphQL query + variables).
 * @param {Record<string, string>} headers Request headers.
 * @returns {Promise<{ data: any }>} Response wrapper.
 */
const request = async (data, headers) => {
  try {
    const result = await $fetch(GITHUB_GRAPHQL_URL, {
      method: "POST",
      headers,
      body: data,
    });
    return { data: result };
  } catch (err) {
    if (err instanceof FetchError && err.data !== undefined) {
      // Normalize to the shape callers expect: err.response.data.message
      const normalized = new Error(err.message);
      // @ts-ignore
      normalized.response = { data: err.data, status: err.status };
      throw normalized;
    }
    throw err;
  }
};

export { request };
