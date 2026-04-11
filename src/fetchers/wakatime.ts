import { CustomError, MissingParamError } from "../common/error";
import type { WakaTimeData } from "./types";

export type FetchWakatimeStatsOptions = {
  username: string | undefined;
  apiDomain?: string;
  fetchImpl?: typeof fetch;
};

type WakatimeApiResponse = {
  data: WakaTimeData;
};

export async function fetchWakatimeStats({
  username,
  apiDomain,
  fetchImpl = fetch,
}: FetchWakatimeStatsOptions): Promise<WakaTimeData> {
  if (username === undefined || username.length === 0) {
    throw new MissingParamError(["username"]);
  }

  const domain = apiDomain?.replace(/\/$/gi, "") || "wakatime.com";
  const response = await fetchImpl(
    `https://${domain}/api/v1/users/${encodeURIComponent(username)}/stats?is_including_today=true`,
  );

  if (!response.ok) {
    throw new CustomError(
      `Could not resolve to a User with the login of '${username}'`,
      "WAKATIME_USER_NOT_FOUND",
    );
  }

  const payload = (await response.json()) as WakatimeApiResponse;
  return payload.data;
}

export default fetchWakatimeStats;
