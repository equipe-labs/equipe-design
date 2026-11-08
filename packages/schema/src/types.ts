// Generated from extract-0.2.schema.json by `npm run gen:types`. Do not edit.

export type Mode = 'light' | 'dark';
export type Count = number;
export type LimitId = string;
export type ColorId = string;
/**
 * Lowercase #rrggbb; alpha is a separate field.
 */
export type Hex = string;
export type Share = number;
export type CssVariableName = string;
/**
 * [x, y, width, height] in CSS px
 *
 * @minItems 4
 * @maxItems 4
 */
export type Rect = [number, number, number, number, ...number[]];
/**
 * @maxItems 5
 */
export type Evidence = EvidenceSample[];
export type Confidence = number;
export type TypeStyleId = string;
export type Reasons = string[];
export type NullableColorId = ColorId | null;

/**
 * equipe-design extraction result (extract.json), schema 0.1. Values observed on pages, interpretations inferred from them, and what could not be seen. Values only: no CSS text, font files, images or page text.
 */
export interface Extraction {
  $comment?: string;
  /**
   * 0.2 adds inferred.catalog (components against the shadcn/ui reference table); 0.1 files stay valid.
   */
  schemaVersion: '0.1' | '0.2';
  tool: {
    name: 'equipe-design';
    version: string;
    /**
     * Chrome version used for capture; null if no browser was opened.
     */
    chrome: string | null;
  };
  run: {
    id: string;
    startedAt: string;
    durationMs: number;
    userAgent: string;
    options: {
      /**
       * @minItems 1
       */
      widths: [number, ...number[]];
      modes: 'auto' | 'light' | 'dark' | 'both';
      states: boolean;
      injectStates?: boolean;
      maxPages: number;
    };
    /**
     * Guardrail that stopped the run before any value was read (CLI exit code 2); null when the run went through.
     */
    stoppedBy: null | 'robots-disallowed' | 'login-required' | 'bot-challenge';
  };
  notice: string;
  source: {
    /**
     * @minItems 1
     * @maxItems 5
     */
    pages: [
      {
        /**
         * Internal record of what was read. Never shown as a display name.
         */
        url: string;
        finalUrl: string | null;
        status: number | null;
        robots: {
          checked: boolean;
          allowed: boolean;
          /**
           * The matching robots.txt rule, e.g. 'Disallow: /'.
           */
          rule: string | null;
        };
        loginWall: boolean;
        visibleElements: number;
        widths: number[];
        modes: Mode[];
      },
      ...{
        /**
         * Internal record of what was read. Never shown as a display name.
         */
        url: string;
        finalUrl: string | null;
        status: number | null;
        robots: {
          checked: boolean;
          allowed: boolean;
          /**
           * The matching robots.txt rule, e.g. 'Disallow: /'.
           */
          rule: string | null;
        };
        loginWall: boolean;
        visibleElements: number;
        widths: number[];
        modes: Mode[];
      }[]
    ];
    modes: {
      light: ModeObservation;
      dark: ModeObservation;
      highContrast?: ModeObservation;
    };
    stylesheets: {
      readable: Count;
      crossOriginParsedInMemory: Count;
      unreadable: Count;
    };
  };
  observed: {
    color: ObservedColor[];
    typography: {
      families: FontFamily[];
      styles: TypeStyle[];
    };
    spacing: ObservedSpacing[];
    radius: ObservedRadius[];
    shadow: ObservedShadow[];
    motion: ObservedMotion[];
    elevation: ObservedElevation[];
    breakpoints: ObservedBreakpoint[];
    variables: ObservedVariable[];
  };
  /**
   * Interpretations. A key is absent when nothing was inferred (e.g. a run stopped by a guardrail); the reason is in limits.
   */
  inferred: {
    scales?: {
      spacing?: Scale;
      radius?: Scale;
      fontSize?: Scale;
    };
    roles?: Role[];
    brand?: Brand;
    typeRoles?: TypeRole[];
    components?: Component[];
    catalog?: Catalog;
  };
  limits: Limit[];
  guardrails: {
    /**
     * exempt: localhost, 127.0.0.1 and file: only.
     */
    robots: 'allowed' | 'disallowed' | 'exempt';
    loginUsed: false;
    freshBrowserProfile: true;
    pagesVisited: number;
    maxPages: number;
    mutatingRequestsBlocked: Count;
    stored: {
      cssText: false;
      fontFiles: false;
      images: false;
      pageText: false;
      /**
       * true only with --evidence-crops; crops stay in the run folder and never reach emitted output.
       */
      screenshots: boolean;
    };
    brandNameInTokenNames: false;
  };
  summary: {
    colors: Count;
    roles: {
      filled: Count;
      empty: Count;
    };
    /**
     * '<color id> <hex>', 'none', 'uncertain', or null when not inferred.
     */
    brand: string | null;
    darkPairs: Count;
    components: Count;
    catalog?: {
      found: Count;
      of: Count;
    };
    limits: Count;
    lowConfidence: string[];
  };
}
export interface ModeObservation {
  observed: boolean;
  method?: 'default' | 'media-query' | 'class-toggle' | 'media-variables';
  detectors?: {
    mediaQuery?: {
      found: boolean;
      rules?: Count;
    };
    classToggle?: {
      found: boolean;
      selector?: string;
      tried?: string[];
    };
    mediaVariables?: {
      found: boolean;
      variablesThatDiffer?: Count;
    };
  };
  limit?: LimitId;
}
export interface ObservedColor {
  id: ColorId;
  value: ColorValue;
  mode: Mode;
  count: Count;
  areaShare?: Share;
  uses: {
    background?: Count;
    text?: Count;
    border?: Count;
    fill?: Count;
    outline?: Count;
  };
  cssVariables?: CssVariableName[];
  /**
   * Original notations merged by normalisation, e.g. 'rgb(246, 245, 241)'.
   */
  mergedFrom?: string[];
  spread?: {
    sections: Count;
    componentClusters: Count;
  };
  evidence: Evidence;
  confidence: Confidence;
}
export interface ColorValue {
  hex: Hex;
  /**
   * [L 0..1, C, H degrees]
   *
   * @minItems 3
   * @maxItems 3
   */
  oklch: [number, number, number, ...number[]];
  alpha: Share;
}
export interface EvidenceSample {
  /**
   * Index into source.pages.
   */
  page: number;
  width: number;
  mode: Mode;
  /**
   * Short DOM path we built (tag + up to 2 classes). Never a stylesheet selector or rule.
   */
  selector: string;
  axRole: string | null;
  prop: string;
  rect: Rect;
}
export interface FontFamily {
  name: string;
  generic: 'serif' | 'sans-serif' | 'monospace' | 'cursive' | 'fantasy' | 'system-ui' | 'unknown';
  count: Count;
  /**
   * webfont: loaded by the page from a font file (the file itself is never stored).
   */
  loadedVia: 'webfont' | 'local' | 'system' | 'unknown';
  /**
   * e.g. 'OFL-1.1 (known family)' or 'commercial-or-unknown'.
   */
  license: string;
  fileStored: false;
  oflAlternatives: string[];
}
export interface TypeStyle {
  id: TypeStyleId;
  family: string;
  size: Length;
  weight: number;
  lineHeight: number | Length;
  letterSpacing: Length;
  count: Count;
  tags?: {
    [k: string]: Count;
  };
  widths?: {
    [k: string]: Length;
  };
  fluid?: {
    detected: boolean;
    from?: string;
  };
  evidence?: Evidence;
  confidence: Confidence;
}
export interface Length {
  value: number;
  unit: 'px' | 'em' | 'rem' | '%';
}
export interface ObservedSpacing {
  value: Length;
  count: Count;
  props: {
    padding?: Count;
    margin?: Count;
    gap?: Count;
  };
  cssVariables?: CssVariableName[];
  evidence?: Evidence;
  confidence: Confidence;
}
export interface ObservedRadius {
  value: Length;
  count: Count;
  shapes?: {
    [k: string]: Count;
  };
  kind?: 'full';
  cssVariables?: CssVariableName[];
  evidence?: Evidence;
  confidence: Confidence;
}
export interface ObservedShadow {
  /**
   * @minItems 1
   */
  value: [
    {
      offsetX: number;
      offsetY: number;
      blur: number;
      spread: number;
      color: {
        hex: Hex;
        alpha: Share;
      };
      inset: boolean;
    },
    ...{
      offsetX: number;
      offsetY: number;
      blur: number;
      spread: number;
      color: {
        hex: Hex;
        alpha: Share;
      };
      inset: boolean;
    }[]
  ];
  count: Count;
  evidence?: Evidence;
  confidence: Confidence;
}
export interface ObservedMotion {
  property: 'transition' | 'animation';
  duration: Duration;
  easing:
    | [number, number, number, number, ...number[]]
    | ('linear' | 'ease' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'step-start' | 'step-end');
  count: Count;
  on?: string[];
  evidence?: Evidence;
  confidence: Confidence;
}
export interface Duration {
  value: number;
  unit: 'ms';
}
export interface ObservedElevation {
  zIndex: number;
  position: 'static' | 'relative' | 'absolute' | 'fixed' | 'sticky';
  count: Count;
  kind?: string;
  evidence?: Evidence;
  confidence: Confidence;
}
export interface ObservedBreakpoint {
  value: Length;
  /**
   * Media condition only, e.g. '(max-width: 720px)'. Never the rule body.
   */
  query: string;
  rulesCount: Count;
  confidence: Confidence;
}
export interface ObservedVariable {
  name: CssVariableName;
  /**
   * @minItems 1
   */
  declaredIn: [
    {
      selector: string;
      /**
       * Enclosing @media/@supports/@layer condition, e.g. '@media (prefers-color-scheme: dark)'.
       */
      condition: string | null;
    },
    ...{
      selector: string;
      /**
       * Enclosing @media/@supports/@layer condition, e.g. '@media (prefers-color-scheme: dark)'.
       */
      condition: string | null;
    }[]
  ];
  values: {
    light?: string;
    dark?: string;
  };
  resolvesTo?: {
    light?: ColorId | null;
    dark?: ColorId | null;
  };
  usedByElements: Count;
}
export interface Scale {
  base?: Length;
  /**
   * px
   */
  steps: number[];
  fit?: Share;
  /**
   * radius only: a pill/circle value (>= height/2) was seen and kept out of steps.
   */
  full?: boolean;
  /**
   * fontSize only: modular ratio, null when fit < 0.8.
   */
  ratio?: number | null;
  outliers?: {
    value: number;
    count: Count;
    reason: string;
  }[];
  reasons: Reasons;
  confidence: Confidence;
  limit?: LimitId;
}
export interface Role {
  role:
    | 'background'
    | 'surface'
    | 'raised'
    | 'text'
    | 'muted-text'
    | 'primary'
    | 'on-primary'
    | 'secondary'
    | 'accent'
    | 'border'
    | 'border-strong'
    | 'ring'
    | 'destructive'
    | 'success'
    | 'warning';
  light: NullableColorId;
  dark: NullableColorId;
  reasons: Reasons;
  alternatives: ColorId[];
  confidence: Confidence;
  limit?: LimitId;
}
export interface Brand {
  status: 'found' | 'none' | 'uncertain';
  color: NullableColorId;
  candidates: {
    color: ColorId;
    score: Share;
    signals: {
      interactiveUse: Share;
      spread: Share;
      variableName: Share;
      usageVariety?: Share;
      themeColorMeta: Share;
      decorativeOnly: boolean;
      singleSubtree: boolean;
    };
  }[];
  reasons: Reasons;
  confidence: Confidence;
  limit?: LimitId;
}
export interface TypeRole {
  role: 'display' | 'h1' | 'h2' | 'h3' | 'body' | 'small' | 'mono';
  style: TypeStyleId | null;
  reasons: Reasons;
  confidence: Confidence;
  limit?: LimitId;
}
export interface Component {
  id: string;
  kind:
    | 'button'
    | 'link'
    | 'textbox'
    | 'checkbox'
    | 'switch'
    | 'tab'
    | 'combobox'
    | 'dialog'
    | 'menuitem'
    | 'card'
    | 'badge'
    | 'list-row';
  /**
   * @minItems 1
   */
  detectedBy: [
    'ax-role' | 'style-cluster' | 'visual-shape' | 'repeated-structure',
    ...('ax-role' | 'style-cluster' | 'visual-shape' | 'repeated-structure')[]
  ];
  instances: Count;
  variants: Variant[];
  sizes?: {
    height: Length;
    count: Count;
  }[];
  reasons: Reasons;
  confidence: Confidence;
}
export interface Variant {
  id: string;
  /**
   * Neutral name from rules (primary, secondary, ghost…). Never a source service name.
   */
  suggestedName: string;
  nameIsSuggestion: true;
  count: Count;
  fingerprint: {
    background: NullableColorId;
    color: NullableColorId;
    border: NullableColorId;
    radius: Length | null;
    height: Length | null;
    paddingX: Length | null;
    typeStyle: TypeStyleId | null;
  };
  states: {
    default: State;
    hover: State;
    'focus-visible': State;
    active: State;
    disabled: State;
  };
  evidence?: Evidence;
}
export interface State {
  observed: boolean;
  method?: 'forcePseudoState' | 'screenshot-diff' | 'on-page-example' | 'inject-attribute';
  /**
   * CSS property -> 'before -> after', colors as ids (e.g. 'c3 -> c7').
   */
  diff?: {
    [k: string]: string;
  };
  limit?: LimitId;
}
/**
 * Components found against a reference table (shadcn/ui): every table entry is in coverage, found or not; the found ones carry variants, states and structure.
 */
export interface Catalog {
  reference: {
    name: string;
    source: string;
    snapshot: string;
    count: Count;
  };
  components: CatalogComponent[];
  coverage: CoverageRow[];
}
export interface CatalogComponent {
  id: string;
  /**
   * Reference table name (button, alert-dialog…).
   */
  name: string;
  category: string;
  /**
   * @minItems 1
   */
  detectedBy: [
    'role' | 'tag' | 'slot' | 'attrs' | 'hint' | 'structure',
    ...('role' | 'tag' | 'slot' | 'attrs' | 'hint' | 'structure')[]
  ];
  instances: Count;
  /**
   * Indexes into source.pages where it was found.
   */
  pages: number[];
  variants: CatalogVariant[];
  /**
   * Size axis (shortest to tallest): heights seen across variants.
   */
  sizes: {
    label: string;
    height: Length;
    count: Count;
  }[];
  parts: {
    name: string;
    present: boolean;
    count: Count;
  }[];
  reasons: Reasons;
  confidence: Confidence;
}
export interface CatalogVariant {
  id: string;
  suggestedName: string;
  nameIsSuggestion: true;
  count: Count;
  /**
   * The site's own data-variant value, when it marks one (kept as evidence; the suggested name stays neutral).
   */
  dataVariant?: string;
  props: CatalogProp[];
  structure: CatalogStructure;
  states: CatalogState[];
  evidence: Evidence;
  confidence: Confidence;
}
/**
 * One value of a variant, tied to a token role. Exactly one of color, length, shadow, typeStyle, number is set.
 */
export interface CatalogProp {
  prop:
    | 'background'
    | 'color'
    | 'border'
    | 'borderWidth'
    | 'radius'
    | 'paddingX'
    | 'paddingY'
    | 'height'
    | 'width'
    | 'gap'
    | 'shadow'
    | 'typeStyle'
    | 'opacity';
  color?: ColorId;
  length?: Length;
  shadow?: ShadowLayer[];
  typeStyle?: TypeStyleId;
  number?: number;
  /**
   * Token role it maps to: a colour role (primary, border…), 'radius.N' / 'space.N' (N = step of the inferred scale, from 1), 'radius.full', 'type.<role>', or null.
   */
  role: string | null;
  /**
   * exact: the value is the role's value; nearest: closest role/step (within tolerance); none: no role fits.
   */
  match: 'exact' | 'nearest' | 'none';
  /**
   * Colour: ΔE to the role's colour; length: px to the step.
   */
  distance?: number;
}
export interface ShadowLayer {
  offsetX: number;
  offsetY: number;
  blur: number;
  spread: number;
  color: {
    hex: Hex;
    alpha: Share;
  };
  inset: boolean;
}
export interface CatalogStructure {
  icon: {
    present: boolean;
    position: 'leading' | 'trailing' | 'only' | 'both' | null;
  };
  label: {
    present: boolean;
    position: 'start' | 'center' | 'end' | null;
  };
  /**
   * Parts of the reference table found inside this variant's instances.
   */
  parts?: string[];
}
export interface CatalogState {
  name: string;
  observed: boolean;
  method?: 'forcePseudoState' | 'on-page-example';
  /**
   * CSS property -> 'before -> after' against the default look, colours as ids.
   */
  diff?: {
    [k: string]: string;
  };
  /**
   * On-page examples of the state.
   */
  count?: number;
  evidence?: Evidence;
  limit?: LimitId;
}
export interface CoverageRow {
  name: string;
  found: boolean;
  instances: Count;
  variants: Count;
  /**
   * Id in catalog.components when found.
   */
  component: string | null;
  detectable: 'static' | 'on-interaction' | 'rare' | 'non-visual';
  /**
   * When not found: why it is often missing and what would reveal it.
   */
  note: string | null;
}
export interface Limit {
  id: LimitId;
  kind:
    | 'robots-disallowed'
    | 'login-required'
    | 'bot-challenge'
    | 'single-page'
    | 'page-cap-reached'
    | 'no-dark-mode'
    | 'dark-only'
    | 'dark-not-detected'
    | 'mode-unobserved'
    | 'state-not-on-page'
    | 'state-no-diff'
    | 'interaction-not-collected'
    | 'unused-on-page'
    | 'cross-origin-css'
    | 'lazy-content'
    | 'cookie-banner'
    | 'iframe-skipped'
    | 'canvas'
    | 'component-not-found'
    | 'timeout'
    | 'policy';
  /**
   * Affected path, e.g. 'inferred.components.k1.*.disabled', or '*'.
   */
  scope: string;
  reason: string;
  effect: string;
  fix: string | null;
}
