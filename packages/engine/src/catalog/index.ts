import json from '../../catalog/shadcn-components.json' with { type: 'json' };
import type { Catalog } from './types.ts';

/** The shadcn/ui reference table (catalog/shadcn-components.json). */
export const SHADCN_CATALOG = json as unknown as Catalog;

export { detectPage, forcePaths, type PageCatalog } from './analyze.ts';
export { buildCatalog, type BuildInput } from './build.ts';
export { probe, HINT_WORDS, VALUE_ATTRS, PRESENCE_ATTRS, LABEL_KEYWORDS, type ProbeNode } from './probe.ts';
export type { Catalog, CatalogEntry, Cue } from './types.ts';
