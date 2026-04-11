import { SECONDARY_ERROR_MESSAGES, TRY_AGAIN_LATER } from "./error";
import { getCardColors } from "./color";
import { encodeHTML } from "./html";
import { clampValue } from "./ops";

export type FlexLayoutDirection = "row" | "column";

export type FlexLayoutOptions = {
  items: string[];
  gap: number;
  direction?: FlexLayoutDirection;
  sizes?: number[];
};

export type ProgressNodeOptions = {
  x: number;
  y: number;
  width: number;
  color: string;
  progress: number;
  progressBarBackgroundColor: string;
  delay: number;
};

export type RenderErrorOptions = {
  title_color?: string | undefined;
  text_color?: string | undefined;
  bg_color?: string | undefined;
  border_color?: string | undefined;
  theme?: string | undefined;
  show_repo_link?: boolean;
};

export type RenderErrorArgs = {
  message: string;
  secondaryMessage?: string | undefined;
  renderOptions?: RenderErrorOptions | undefined;
};

export const ERROR_CARD_LENGTH = 576.5;

const UPSTREAM_API_ERRORS = [TRY_AGAIN_LATER, SECONDARY_ERROR_MESSAGES.MAX_RETRY];

export function flexLayout({ items, gap, direction, sizes = [] }: FlexLayoutOptions): string[] {
  let lastSize = 0;
  return items.filter(Boolean).map((item, index) => {
    const size = sizes[index] ?? 0;
    const transform =
      direction === "column" ? `translate(0, ${lastSize})` : `translate(${lastSize}, 0)`;
    lastSize += size + gap;
    return `<g transform="${transform}">${item}</g>`;
  });
}

export function createLanguageNode(langName: string, langColor: string): string {
  return `
    <g data-testid="primary-lang">
      <circle data-testid="lang-color" cx="0" cy="-5" r="6" fill="${langColor}" />
      <text data-testid="lang-name" class="gray" x="15">${langName}</text>
    </g>
  `;
}

export function createProgressNode({
  x,
  y,
  width,
  color,
  progress,
  progressBarBackgroundColor,
  delay,
}: ProgressNodeOptions): string {
  const progressPercentage = clampValue(progress, 2, 100);

  return `
    <svg width="${width}" x="${x}" y="${y}">
      <rect rx="5" ry="5" x="0" y="0" width="${width}" height="8" fill="${progressBarBackgroundColor}"></rect>
      <svg data-testid="lang-progress" width="${progressPercentage}%">
        <rect
          height="8"
          fill="${color}"
          rx="5" ry="5" x="0" y="0"
          class="lang-progress"
          style="animation-delay: ${delay}ms;"
        />
      </svg>
    </svg>
  `;
}

export function iconWithLabel(
  icon: string,
  label: number | string,
  testid: string,
  iconSize: number,
): string {
  if (typeof label === "number" && label <= 0) {
    return "";
  }

  const iconSvg = `
    <svg
      class="icon"
      y="-12"
      viewBox="0 0 16 16"
      version="1.1"
      width="${iconSize}"
      height="${iconSize}"
    >
      ${icon}
    </svg>
  `;
  const text = `<text data-testid="${testid}" class="gray">${label}</text>`;
  return flexLayout({ items: [iconSvg, text], gap: 20 }).join("");
}

export function renderError({
  message,
  secondaryMessage = "",
  renderOptions = {},
}: RenderErrorArgs): string {
  const {
    title_color,
    text_color,
    bg_color,
    border_color,
    theme = "default",
    show_repo_link = true,
  } = renderOptions;

  const { titleColor, textColor, bgColor, borderColor } = getCardColors({
    title_color,
    text_color,
    icon_color: "",
    bg_color,
    border_color,
    ring_color: "",
    theme,
  });

  return `
    <svg width="${ERROR_CARD_LENGTH}" height="120" viewBox="0 0 ${ERROR_CARD_LENGTH} 120" fill="${bgColor}" xmlns="http://www.w3.org/2000/svg">
      <style>
        .text { font: 600 16px 'Segoe UI', Ubuntu, Sans-Serif; fill: ${titleColor} }
        .small { font: 600 12px 'Segoe UI', Ubuntu, Sans-Serif; fill: ${textColor} }
        .gray { fill: #858585 }
      </style>
      <rect x="0.5" y="0.5" width="${ERROR_CARD_LENGTH - 1}" height="99%" rx="4.5" fill="${bgColor}" stroke="${borderColor}"/>
      <text x="25" y="45" class="text">Something went wrong!${
        UPSTREAM_API_ERRORS.includes(secondaryMessage) || !show_repo_link
          ? ""
          : " file an issue at https://tiny.one/readme-stats"
      }</text>
      <text data-testid="message" x="25" y="55" class="text small">
        <tspan x="25" dy="18">${encodeHTML(message)}</tspan>
        <tspan x="25" dy="18" class="gray">${secondaryMessage}</tspan>
      </text>
    </svg>
  `;
}

export function measureText(str: string, fontSize = 10): number {
  const widths = [
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0.2796875, 0.2765625, 0.3546875, 0.5546875, 0.5546875, 0.8890625, 0.665625, 0.190625, 0.3328125,
    0.3328125, 0.3890625, 0.5828125, 0.2765625, 0.3328125, 0.2765625, 0.3015625, 0.5546875,
    0.5546875, 0.5546875, 0.5546875, 0.5546875, 0.5546875, 0.5546875, 0.5546875, 0.5546875,
    0.5546875, 0.2765625, 0.2765625, 0.584375, 0.5828125, 0.584375, 0.5546875, 1.0140625, 0.665625,
    0.665625, 0.721875, 0.721875, 0.665625, 0.609375, 0.7765625, 0.721875, 0.2765625, 0.5, 0.665625,
    0.5546875, 0.8328125, 0.721875, 0.7765625, 0.665625, 0.7765625, 0.721875, 0.665625, 0.609375,
    0.721875, 0.665625, 0.94375, 0.665625, 0.665625, 0.609375, 0.2765625, 0.3546875, 0.2765625,
    0.4765625, 0.5546875, 0.3328125, 0.5546875, 0.5546875, 0.5, 0.5546875, 0.5546875, 0.2765625,
    0.5546875, 0.5546875, 0.221875, 0.240625, 0.5, 0.221875, 0.8328125, 0.5546875, 0.5546875,
    0.5546875, 0.5546875, 0.3328125, 0.5, 0.2765625, 0.5546875, 0.5, 0.721875, 0.5, 0.5, 0.5,
    0.3546875, 0.259375, 0.353125, 0.5890625,
  ];

  const average = 0.5279276315789471;
  return (
    str
      .split("")
      .map((character) => {
        const index = character.charCodeAt(0);
        return index < widths.length ? widths[index] : average;
      })
      .reduce((sum, current) => sum + current, 0) * fontSize
  );
}
