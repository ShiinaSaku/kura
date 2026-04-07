// @ts-check

import { $fetch, FetchError } from "ofetch";
import { CustomError, MissingParamError } from "../common/error.js";

/**
 * WakaTime data fetcher.
 *
 * @param {{username: string, api_domain: string }} props Fetcher props.
 * @returns {Promise<import("./types").WakaTimeData>} WakaTime data response.
 */
const fetchWakatimeStats = async ({ username, api_domain }) => {
  if (!username) {
    throw new MissingParamError(["username"]);
  }

  const domain = api_domain ? api_domain.replace(/\/$/gi, "") : "wakatime.com";

  try {
    const data = await $fetch(
      `https://${domain}/api/v1/users/${username}/stats?is_including_today=true`,
    );
    return data.data;
  } catch (err) {
    if (err instanceof FetchError && err.status != null && (err.status < 200 || err.status > 299)) {
      throw new CustomError(
        `Could not resolve to a User with the login of '${username}'`,
        "WAKATIME_USER_NOT_FOUND",
      );
    }
    throw err;
  }
};

export { fetchWakatimeStats };
export default fetchWakatimeStats;
