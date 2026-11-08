// The reference table (catalog/shadcn-components.json): every shadcn/ui component, how to
// recognise it on a page, which values to read from it and which states it has. The
// matcher (match.ts) reads these entries; adding a component is a JSON edit.

/** A page element is read by the probe (probe.ts) into a ProbeNode; a Cue tests one. Every field given must match; omitted fields are ignored. */
export interface Cue {
  /** Lowercase tag name, any of. */
  tag?: string[];
  /** ARIA role, explicit or implicit (button for <button>, link for <a href>, textbox for <input>…), any of. */
  role?: string[];
  /** `data-slot` value (shadcn/ui v4 marks every part with it), any of. */
  slot?: string[];
  /** Attribute present (`true`) or equal to the string. Names: aria-*, data-state, data-variant, data-size, data-orientation, aria-label (matched by keyword only), type, … */
  attrs?: Record<string, string | true>;
  /** `<input type>`, any of. */
  inputType?: string[];
  /** Words in class names, from the probe's fixed vocabulary (see HINT_WORDS in probe.ts), any of. Weak evidence. */
  hint?: string[];
  /** Some ancestor (up to 8 levels up) must match this cue. */
  inside?: Cue;
}

export type CatalogProp =
  | 'background' | 'color' | 'border' | 'borderWidth' | 'radius'
  | 'paddingX' | 'paddingY' | 'height' | 'width' | 'gap' | 'shadow' | 'typeStyle' | 'opacity';

/** Part of a component (Card header, Dialog footer…) found inside the root by a cue. */
export interface CatalogPart {
  name: string;
  cue: Cue;
}

/** `static`: visible on a normal page load. `on-interaction`: only exists after a click/hover/focus (dialog, tooltip, menu…), so it is found only when a page shows it open. `rare`: unusual outside docs/AI apps. `non-visual`: no visual of its own. */
export type Detectable = 'static' | 'on-interaction' | 'rare' | 'non-visual';

export interface CatalogEntry {
  /** shadcn/ui name: `button`, `alert-dialog`… */
  name: string;
  category: 'form' | 'action' | 'navigation' | 'overlay' | 'feedback' | 'display' | 'layout' | 'data' | 'ai' | 'other';
  /** Docs page, https://ui.shadcn.com/docs/components/<name>. */
  docs: string;
  /** One-line description of the component, in English. */
  summary: string;
  detectable: Detectable;
  /** The root element of an instance matches ANY of these cues (a cue matches when all its fields match). */
  cues: Cue[];
  /** Name of a built-in structural matcher in match.ts for components a cue cannot express (badge, card, avatar…). A node matches when a cue OR the structure matches. */
  structure?: string;
  /** Parts inside the root, reported as `structure.parts`. */
  parts?: CatalogPart[];
  /** Values read from the root and mapped to token roles. */
  props: CatalogProp[];
  /** Names from STATE_NAMES this component has, in the order shown to people. */
  states: string[];
  /** Variant axes shadcn gives this component (`variant`, `size`…), as hints for naming. */
  axes?: Record<string, string[]>;
  /** Cue → what a root of this component looks like when it is in each on-page state (checked, open…), to compare against the default look. */
  stateCues?: Record<string, Cue>;
  /** Why it may be missing and what would find it (shown in report.md when not found). */
  hintWhenMissing: string;
}

export interface Catalog {
  reference: { name: 'shadcn/ui'; source: string; snapshot: string };
  /** The state names this table uses. */
  stateNames: string[];
  components: CatalogEntry[];
}

export const STATE_NAMES = [
  'default', 'hover', 'focus-visible', 'active', 'disabled',
  'checked', 'unchecked', 'indeterminate', 'selected', 'pressed', 'open', 'closed', 'expanded', 'collapsed',
  'invalid', 'loading', 'current', 'on', 'off',
] as const;
