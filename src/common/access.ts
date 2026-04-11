import { renderError } from "./render";
import { blacklist } from "./blacklist";
import { whitelist, gistWhitelist } from "./envs";

const NOT_WHITELISTED_USERNAME_MESSAGE = "This username is not whitelisted";
const NOT_WHITELISTED_GIST_MESSAGE = "This gist ID is not whitelisted";
const BLACKLISTED_MESSAGE = "This username is blacklisted";

type GuardColors = {
  title_color?: string | undefined;
  text_color?: string | undefined;
  bg_color?: string | undefined;
  border_color?: string | undefined;
  theme?: string | undefined;
};

type GuardAccessArgs = {
  id?: string | undefined;
  type: "username" | "gist" | "wakatime";
  colors: GuardColors;
};

type GuardAccessResult = { isPassed: true } | { isPassed: false; svg: string };

/**
 * Guards access using whitelist/blacklist.
 */
const guardAccess = ({ id, type, colors }: GuardAccessArgs): GuardAccessResult => {
  const normalizedId = id ?? "";

  if (!["username", "gist", "wakatime"].includes(type)) {
    throw new Error('Invalid type. Expected "username", "gist", or "wakatime".');
  }

  const currentWhitelist = type === "gist" ? gistWhitelist : whitelist;
  const notWhitelistedMsg =
    type === "gist" ? NOT_WHITELISTED_GIST_MESSAGE : NOT_WHITELISTED_USERNAME_MESSAGE;

  if (Array.isArray(currentWhitelist) && !currentWhitelist.includes(normalizedId)) {
    return {
      isPassed: false,
      svg: renderError({
        message: notWhitelistedMsg,
        secondaryMessage: "Please deploy your own instance",
        renderOptions: {
          ...colors,
          show_repo_link: false,
        },
      }),
    };
  }

  if (type === "username" && currentWhitelist === undefined && blacklist.includes(normalizedId)) {
    return {
      isPassed: false,
      svg: renderError({
        message: BLACKLISTED_MESSAGE,
        secondaryMessage: "Please deploy your own instance",
        renderOptions: {
          ...colors,
          show_repo_link: false,
        },
      }),
    };
  }

  return { isPassed: true };
};

export { guardAccess };
