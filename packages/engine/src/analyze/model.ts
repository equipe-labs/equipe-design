import type { Mode } from '@equipe-design/schema';
import type { Rgba, SheetScan, StateProps, SweepResult, VarValue } from '../capture/inpage.ts';
import type { StateName } from '../capture/page.ts';
import type { PageCatalog } from '../catalog/analyze.ts';

/** Everything captured from one page, in memory only. */
export interface PageData {
  index: number;
  url: string;
  sweeps: { mode: Mode; width: number; result: SweepResult }[];
  scan: SheetScan;
  vars: Partial<Record<Mode, Record<string, VarValue>>>;
  usage: Record<string, number>;
  themeColor: Rgba | null;
  fonts: { family: string; status: string }[];
  states: Record<string, Partial<Record<'default' | StateName, StateProps>>>;
  /** Components of the reference table found on this page (catalog/). */
  catalog?: PageCatalog;
  /** Set when the catalog read threw (error class name only); the base extract went on. */
  catalogFailure?: string;
}

/** One sample: an element (page + path) and the property a value was seen on. */
export interface Sample {
  page: number;
  path: string;
  prop: string;
}

export const sampleKey = (s: Sample) => `${s.page}|${s.path}|${s.prop}`;
export const elementKey = (page: number, path: string) => `${page}|${path}`;

