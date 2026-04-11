type ThemeNames = keyof typeof import("../../themes/index.js").themes;
type RankIcon = "default" | "github" | "percentile";

export type CommonOptions = {
  title_color: string | undefined;
  icon_color: string | undefined;
  text_color: string | undefined;
  bg_color: string | undefined;
  theme: ThemeNames | undefined;
  border_radius: number | undefined;
  border_color: string | undefined;
  locale: string | undefined;
  hide_border: boolean | undefined;
};

export type StatCardOptions = CommonOptions & {
  hide: string[] | undefined;
  show_icons: boolean | undefined;
  hide_title: boolean | undefined;
  card_width: number | undefined;
  hide_rank: boolean | undefined;
  include_all_commits: boolean | undefined;
  commits_year: number | undefined;
  line_height: number | string | undefined;
  custom_title: string | undefined;
  disable_animations: boolean | undefined;
  number_format: string | undefined;
  number_precision: number | undefined;
  ring_color: string | undefined;
  text_bold: boolean | undefined;
  rank_icon: RankIcon | undefined;
  show: string[] | undefined;
};

export type RepoCardOptions = CommonOptions & {
  show_owner: boolean | undefined;
  description_lines_count: number | undefined;
};

export type TopLangOptions = CommonOptions & {
  hide_title: boolean | undefined;
  card_width: number | undefined;
  hide: string[] | undefined;
  layout: "compact" | "normal" | "donut" | "donut-vertical" | "pie" | undefined;
  custom_title: string | undefined;
  langs_count: number | undefined;
  disable_animations: boolean | undefined;
  hide_progress: boolean | undefined;
  stats_format: "percentages" | "bytes" | undefined;
};

export type WakaTimeOptions = CommonOptions & {
  hide_title: boolean | undefined;
  hide: string[] | undefined;
  card_width: number | undefined;
  line_height: string | number | undefined;
  hide_progress: boolean | undefined;
  custom_title: string | undefined;
  layout: "compact" | "normal" | undefined;
  langs_count: number | undefined;
  display_format: "time" | "percent" | undefined;
  disable_animations: boolean | undefined;
};

export type GistCardOptions = CommonOptions & {
  show_owner: boolean | undefined;
};
