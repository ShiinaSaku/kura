import type { Theme } from "../../themes/index.js";
import { themes } from "../../themes/index.js";

export type CardColors = {
  titleColor: string;
  iconColor: string;
  textColor: string;
  bgColor: string | string[];
  borderColor: string;
  ringColor: string;
};

type GetCardColorsArgs = {
  title_color?: string | undefined;
  text_color?: string | undefined;
  icon_color?: string | undefined;
  bg_color?: string | undefined;
  border_color?: string | undefined;
  ring_color?: string | undefined;
  theme?: string | undefined;
};

const isValidHexColor = (hexColor: string): boolean => {
  return new RegExp(/^([A-Fa-f0-9]{8}|[A-Fa-f0-9]{6}|[A-Fa-f0-9]{3}|[A-Fa-f0-9]{4})$/).test(
    hexColor,
  );
};

const isValidGradient = (colors: string[]): boolean => {
  return colors.length > 2 && colors.slice(1).every((color) => isValidHexColor(color));
};

const fallbackColor = (
  color: string | undefined,
  fallbackValue: string | string[],
): string | string[] => {
  const colors = color ? color.split(",") : [];
  if (colors.length > 1 && isValidGradient(colors)) {
    return colors;
  }
  if (color && isValidHexColor(color)) {
    return `#${color}`;
  }
  return fallbackValue;
};

const getCardColors = ({
  title_color,
  text_color,
  icon_color,
  bg_color,
  border_color,
  ring_color,
  theme,
}: GetCardColorsArgs): CardColors => {
  const defaultTheme = themes["default"] as Theme;
  const themeData = theme !== undefined && theme !== null ? themes[theme] : undefined;
  const selectedTheme: Theme = themeData ?? defaultTheme;

  const defaultBorderColor =
    "border_color" in selectedTheme ? selectedTheme.border_color : defaultTheme.border_color;

  const titleColor = fallbackColor(
    title_color || selectedTheme.title_color,
    "#" + defaultTheme.title_color,
  );

  const ringColor = fallbackColor(ring_color || selectedTheme.ring_color, titleColor);

  const iconColor = fallbackColor(
    icon_color || selectedTheme.icon_color,
    "#" + defaultTheme.icon_color,
  );

  const textColor = fallbackColor(
    text_color || selectedTheme.text_color,
    "#" + defaultTheme.text_color,
  );

  const bgColor = fallbackColor(bg_color || selectedTheme.bg_color, "#" + defaultTheme.bg_color);

  const borderColor = fallbackColor(
    border_color || defaultBorderColor,
    "#" + (defaultBorderColor ?? defaultTheme.title_color),
  );

  if (
    typeof titleColor !== "string" ||
    typeof textColor !== "string" ||
    typeof ringColor !== "string" ||
    typeof iconColor !== "string" ||
    typeof borderColor !== "string"
  ) {
    throw new Error("Unexpected behavior, all colors except background should be string.");
  }

  return { titleColor, iconColor, textColor, bgColor, borderColor, ringColor };
};

export { isValidHexColor, isValidGradient, getCardColors };
