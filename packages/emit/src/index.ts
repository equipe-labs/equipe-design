import { posix as path } from 'node:path';
import type { EmitOptions } from './formats/common.ts';
import { css } from './formats/css.ts';
import { kotlin } from './formats/kotlin.ts';
import { shadcn } from './formats/shadcn.ts';
import { swift } from './formats/swift.ts';
import { tailwind } from './formats/tailwind.ts';
import { modelFromResolved, toDtcg } from './dtcg.ts';
import { resolveFiles, type DtcgFiles } from './tokens.ts';

export { toDtcg, modelFromResolved, radiusNames, type ToDtcgOptions } from './dtcg.ts';
export { resolveFiles, type DtcgFiles, type Json, type JsonObject, type Token } from './tokens.ts';
export type { EmitOptions };

export const FORMATS = ['dtcg', 'css', 'tailwind', 'shadcn', 'swift', 'kotlin'] as const;
export type Format = (typeof FORMATS)[number];

export class EmitError extends Error {}

/** Finds any forbidden label in a token name or a file name. Values (fonts, colours) are not names and are not checked. */
export function findForbidden(files: DtcgFiles, forbidden: string[]): string[] {
  const labels = forbidden.map((s) => s.toLowerCase()).filter((s) => s.length >= 3);
  const hits: string[] = [];
  const check = (where: string, text: string) => {
    const t = text.toLowerCase();
    for (const l of labels) if (t.includes(l)) hits.push(`${where}: "${text}" contains "${l}"`);
  };
  const walk = (node: unknown, trail: string[], file: string) => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return;
    for (const [k, v] of Object.entries(node)) {
      if (k.startsWith('$')) continue;
      check(`${file} ${[...trail, k].join('.')}`, k);
      walk(v, [...trail, k], file);
    }
  };
  for (const [file, tree] of Object.entries(files)) {
    check('file name', file);
    walk(tree, [], file);
  }
  return hits;
}

const OUT_NAMES: Record<Exclude<Format, 'dtcg'>, (o: EmitOptions) => string> = {
  css: () => 'tokens.css',
  tailwind: () => 'theme.css',
  shadcn: () => 'shadcn.css',
  swift: (o) => `${o.typePrefix ?? 'Eq'}Tokens.swift`,
  kotlin: (o) => `${o.typePrefix ?? 'Eq'}Tokens.kt`,
};

/**
 * Writes the chosen formats from DTCG files. Returns file name -> text.
 * Fails (EmitError) when a source label shows up in a token or file name.
 */
export function emit(tokens: DtcgFiles, formats: Format[], opts: EmitOptions & { legacy?: boolean } = {}): Record<string, string> {
  const labels = opts.forbidden ?? [];
  const names = [...Object.keys(tokens), ...formats.map((f) => (f === 'dtcg' ? 'tokens/' : OUT_NAMES[f](tokens_opts(opts))))];
  const hits = findForbidden(tokens, labels);
  for (const n of names) for (const l of labels) if (l.length >= 3 && n.toLowerCase().includes(l.toLowerCase())) hits.push(`file name: "${n}" contains "${l}"`);
  if (hits.length) throw new EmitError(`a source site's name is in the output (${hits.length}): ${hits.slice(0, 3).join('; ')}`);
  const out: Record<string, string> = {};
  const resolved = resolveFiles(tokens);
  const o = tokens_opts(opts);
  for (const f of formats) {
    switch (f) {
      case 'dtcg':
        for (const [name, tree] of Object.entries(opts.legacy ? toDtcg(modelFromResolved(resolved), { legacy: true }) : tokens)) out[path.join('dtcg', name)] = JSON.stringify(tree, null, 2) + '\n';
        break;
      case 'css': out[OUT_NAMES.css(o)] = css(resolved, o); break;
      case 'tailwind': out[OUT_NAMES.tailwind(o)] = tailwind(resolved); break;
      case 'shadcn': out[OUT_NAMES.shadcn(o)] = shadcn(resolved, o); break;
      case 'swift': out[OUT_NAMES.swift(o)] = swift(resolved, o); break;
      case 'kotlin': out[OUT_NAMES.kotlin(o)] = kotlin(resolved, o); break;
      default: throw new EmitError(`unknown format "${String(f)}"; use one of ${FORMATS.join(', ')}`);
    }
  }
  return out;
}

function tokens_opts(o: EmitOptions): EmitOptions {
  const prefix = o.prefix ?? 'eq';
  return { ...o, prefix, typePrefix: o.typePrefix ?? prefix.charAt(0).toUpperCase() + prefix.slice(1) };
}
