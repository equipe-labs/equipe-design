export type ToolName = 'equipe-design' | 'designlang' | 'dembrandt';
export const TOOLS: ToolName[] = ['equipe-design', 'designlang', 'dembrandt'];
export const TOOL_LABEL: Record<ToolName, string> = {
  'equipe-design': 'equipe-design',
  designlang: 'designlang 13.3.2',
  dembrandt: 'Dembrandt 0.39.2',
};

export type MetricName = 'colors' | 'darkPairs' | 'darkRoles' | 'spacing' | 'radius' | 'typography' | 'brand' | 'darkOnly';

/** `eval/answers/<host>.json`. Every section names its source; the file carries `checkedAt`. */
export interface Answer {
  host: string;
  url: string;
  checkedAt: string;
  sources: { label: string; url: string }[];
  dark?: { method: 'media' | 'class' | 'attribute' | 'none' | 'dark-only'; toggle?: string; source: string };
  colors?: {
    source: string;
    note?: string;
    items: {
      name: string;
      var?: string;
      role?: string;
      light: string | null;
      dark: string | null;
      /** false: the light value is not used on the page — left out of the colours row. */
      usedOnPage?: boolean;
      /** false: the (light, dark) pair is not on the page (CSS or drawn) — left out of the dark-pair denominator. Implied by `usedOnPage: false`. */
      pairOnPage?: boolean;
    }[];
  };
  spacing?: { source: string; px: number[]; note?: string };
  radius?: { source: string; px: number[]; note?: string };
  typography?: { source: string; families?: string[]; fontSizesPx?: number[] };
  brand?: { source: string; value: string; note?: string };
  notes?: string[];
}

export interface SiteSpec {
  host: string;
  spare?: boolean;
  metrics: MetricName[];
  goals: Partial<Record<MetricName, string>>;
}

/** One tool's output for one site, reduced to what the scorer compares. `null` = the tool doesn't produce it. */
export interface ToolResult {
  tool: ToolName;
  host: string;
  status: 'ok' | 'missing' | 'error' | 'stopped';
  error?: string;
  secs: number | null;
  /** Every colour the tool reported, either mode. */
  colors: string[];
  /** Colours the tool reported for dark mode, when it separates them. */
  darkColors: string[] | null;
  spacing: number[] | null;
  radius: number[] | null;
  /** Number of radius entries including non-px ones (`50%`), the precision denominator. */
  radiusCount?: number;
  families: string[] | null;
  fontSizes: number[] | null;
  /** (light, dark) pairs the tool claims; null when it has no pairing. */
  pairs: { name?: string; light: string; dark: string }[] | null;
  pairsLabel?: string;
  /** Dark value per CSS variable / per role. */
  darkByVar: Record<string, string | null> | null;
  lightByVar?: Record<string, string | null> | null;
  darkByRole: Record<string, string | null> | null;
  brand: { status: 'found' | 'none' | 'uncertain'; color: string | null; top?: string | null } | null;
  darkOnly: boolean | null;
}

export interface Cell {
  text: string;
  /** true met the goal, false missed it, undefined no goal / not comparable. */
  pass?: boolean;
}
