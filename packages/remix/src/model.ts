// The one internal shape every input is turned into before remixing, and every output is written from.
export const ROLES = [
  'background', 'surface', 'raised', 'text', 'muted-text', 'primary', 'on-primary', 'secondary',
  'accent', 'border', 'border-strong', 'ring', 'destructive', 'success', 'warning',
] as const;
export type RoleName = (typeof ROLES)[number];
export type Mode = 'light' | 'dark';
export type ColorMap = Record<RoleName, string>;

export const TYPE_ROLES = ['display', 'h1', 'h2', 'h3', 'body', 'small', 'mono'] as const;
export type TypeRoleName = (typeof TYPE_ROLES)[number];

/** Where a role colour came from. `ref` is an id inside the source (an extraction colour id, a library token), never a site name. */
export interface Provenance {
  kind: 'observed' | 'derived' | 'default' | 'brand' | 'contrast-fix';
  ref?: string;
  note?: string;
  from?: string;
}

export interface TypeStyle {
  family: 'sans' | 'mono' | 'display';
  /** px */
  size: number;
  weight: number;
  /** unitless ratio */
  lineHeight: number;
  /** em */
  letterSpacing: number;
}

export interface ShadowLayer {
  offsetX: number;
  offsetY: number;
  blur: number;
  spread: number;
  color: string;
  alpha: number;
  inset: boolean;
}

export interface Model {
  colors: { light: ColorMap; dark: ColorMap | null };
  provenance: { light: Partial<Record<RoleName, Provenance>>; dark: Partial<Record<RoleName, Provenance>> };
  /** CSS family stacks, first entry is the font itself. */
  fonts: { sans: string[]; mono: string[]; display: string[] | null };
  type: Partial<Record<TypeRoleName, TypeStyle>>;
  /** px steps, ascending. */
  space: number[];
  /** px steps, ascending, without the pill. */
  radius: number[];
  shadows: ShadowLayer[][];
  motion: { durations: [number, number, number]; easing: [number, number, number, number] };
  zIndex: number[];
}

/** A source after loading: the model plus what remix needs to know about it. */
export interface Source {
  kind: 'extraction' | 'library';
  /** Internal label (a host or a library system name). Kept in remix.json; it must never reach a token or file name. */
  label: string;
  /** Hosts / names that emit refuses to see in token or file names. */
  forbiddenLabels: string[];
  model: Model;
  /** The source's own brand colour per mode, or null when there is none. */
  brand: { light: string | null; dark: string | null };
  /** Library / extraction items that could not be filled from observation. */
  limits: string[];
  fonts: { name: string; role: 'sans' | 'mono' | 'display'; oflAlternatives: string[]; license: string | null }[];
}
