import { ROLES } from '@equipe-design/remix';
import { HEADER, byPrefix, hexA, stepOf, trim, typo, view } from './common.ts';
import { familyCss, shadowCss } from './css.ts';
import { shadows } from './common.ts';
import type { Resolved, Rgba } from '../tokens.ts';

/** Tailwind CSS v4: tokens in an `@theme` block, dark values overriding the same variables under `.dark`. */
export function tailwind(r: Resolved): string {
  const v = view(r);
  const light = v.colors('light')!;
  const dark = v.colors('dark');
  const lines = [`/* ${HEADER} */`, '@import "tailwindcss";', '', '@custom-variant dark (&:where(.dark, .dark *));', '', '@theme {', '  /* colour roles: bg-background, text-text, border-border … */'];
  for (const role of ROLES) lines.push(`  --color-${role}: ${hexA(light[role])};`);
  if (v.raw.length) {
    lines.push('', '  /* palette: bg-teal-600 … (the step is lightness, 0 light to 1000 dark) */');
    for (const t of v.raw) lines.push(`  --color-${t.path[2]}-${stepOf(t)}: ${hexA(t.value as Rgba)};`);
  }
  const fam = byPrefix(v.shape, 'font.family');
  if (fam.length) {
    lines.push('', '  /* fonts */');
    for (const t of fam) lines.push(`  --font-${stepOf(t)}: ${familyCss(t.value as string[])};`);
  }
  const rad = byPrefix(v.shape, 'radius');
  if (rad.length) {
    lines.push('', '  /* radius */');
    for (const t of rad) lines.push(`  --radius-${stepOf(t)}: ${trim(t.value as number)}px;`);
  }
  const types = byPrefix(v.shape, 'type');
  if (types.length) {
    lines.push('', '  /* type roles: text-body, text-h1 … */');
    for (const t of types) {
      const x = typo(t);
      lines.push(`  --text-${stepOf(t)}: ${trim(x.size)}px;`, `  --text-${stepOf(t)}--line-height: ${trim(Math.round((x.line / x.size) * 1000) / 1000)};`, `  --text-${stepOf(t)}--letter-spacing: ${trim(x.tracking)}em;`, `  --text-${stepOf(t)}--font-weight: ${x.weight};`);
    }
  }
  const sh = byPrefix(v.shape, 'shadow');
  if (sh.length) {
    lines.push('', '  /* shadow */');
    for (const t of sh) lines.push(`  --shadow-${stepOf(t)}: ${shadowCss(shadows(t))};`);
  }
  const dur = byPrefix(v.shape, 'duration');
  if (dur.length) {
    lines.push('', '  /* motion */');
    for (const t of dur) lines.push(`  --duration-${stepOf(t)}: ${trim(t.value as number)}ms;`);
    for (const t of byPrefix(v.shape, 'easing')) lines.push(`  --ease-${stepOf(t)}: cubic-bezier(${(t.value as number[]).join(', ')});`);
  }
  lines.push('}');
  if (dark) {
    const diff = ROLES.filter((role) => hexA(dark[role]) !== hexA(light[role]));
    lines.push('', '.dark {', ...diff.map((role) => `  --color-${role}: ${hexA(dark[role])};`), '}');
  }
  return lines.join('\n') + '\n';
}
