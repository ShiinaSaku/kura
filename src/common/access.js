// @ts-check

import { renderError } from "./render.js";
import { blacklist } from "./blacklist.js";
import { whitelist, gistWhitelist } from "./envs.js";

const NOT_WHITELISTED_USERNAME_MESSAGE = "This username is not whitelisted";
const NOT_WHITELISTED_GIST_MESSAGE = "This gist ID is not whitelisted";
const BLACKLISTED_MESSAGE = "This username is blacklisted";

/**
 * Guards access using whitelist/blacklist.
 *
 * Returns `{ isPassed: true }` when access is granted, or
 * `{ isPassed: false, svg: string }` containing an error SVG when denied.
 * Callers are responsible for sending the SVG back to the client.
 *
 * @param {Object} args The parameters object.
 * @param {string} args.id Resource identifier (username or gist id).
 * @param {"username"|"gist"|"wakatime"} args.type The type of identifier.
 * @param {{ title_color?: string, text_color?: string, bg_color?: string, border_color?: string, theme?: string }} args.colors Color options for the error card.
 * @returns {{ isPassed: boolean, svg?: string }} The result object.
 */
const guardAccess = ({ id, type, colors }) => {
  if (!["username", "gist", "wakatime"].includes(type)) {
    throw new Error('Invalid type. Expected "username", "gist", or "wakatime".');
  }

  const currentWhitelist = type === "gist" ? gistWhitelist : whitelist;
  const notWhitelistedMsg =
    type === "gist" ? NOT_WHITELISTED_GIST_MESSAGE : NOT_WHITELISTED_USERNAME_MESSAGE;

  if (Array.isArray(currentWhitelist) && !currentWhitelist.includes(id)) {
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

  if (type === "username" && currentWhitelist === undefined && blacklist.includes(id)) {
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
