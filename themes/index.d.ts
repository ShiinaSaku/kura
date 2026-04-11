export type Theme = {
  title_color: string;
  icon_color: string;
  text_color: string;
  bg_color: string;
  border_color?: string;
  ring_color?: string;
};

export declare const themes: Record<string, Theme | undefined>;
