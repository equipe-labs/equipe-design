import { ROLES } from '@equipe-design/remix';
import { HEADER, byPrefix, hexA, kebab, shadows, trim, typo, view, type EmitOptions, type View } from './common.ts';
import type { ShadowV, Token } from '../tokens.ts';

export const quoteFamily = (f: string) => (/[\s\d]/.test(f) && !/^(ui-|-apple-)/.test(f) ? `'${f}'` : f);
export const familyCss = (a: string[]) => a.map(quoteFamily).join(', ');
export const shadowCss = (s: ShadowV[]) => s.map((x) => `${x.inset ? 'inset ' : ''}${trim(x.x)}px ${trim(x.y)}px ${trim(x.blur)}px ${trim(x.spread)}px ${hexA(x.color)}`).join(', ');

/** Value of one non-colour token, as CSS. Typography is `weight size/line family`. */
export function valueCss(t: Token, v: View, p: string): string {
  switch (t.type) {
    case 'dimension': return `${trim(t.value as number)}px`;
    case 'duration': return `${trim(t.value as number)}ms`;
    case 'number': case 'fontWeight': return trim(t.value as number);
    case 'cubicBezier': return `cubic-bezier(${(t.value as number[]).join(', ')})`;
    case 'fontFamily': return familyCss(t.value as string[]);
    case 'shadow': return shadowCss(shadows(t));
    case 'typography': {
      const x = typo(t);
      const fam = x.mono ? `var(--${p}-font-family-mono)` : v.find(v.light, 'font.family.display') && !x.family.every((f, i) => f === (v.find(v.light, 'font.family.sans')?.value as string[])[i]) ? `var(--${p}-font-family-display)` : `var(--${p}-font-family-sans)`;
      return `${x.weight} ${trim(x.size)}px/${trim(Math.round((x.line / x.size) * 1000) / 1000)} ${fam}`;
    }
    default: throw new Error(`css: ${t.name} ${t.type}`);
  }
}

export function css(r: Parameters<typeof view>[0], o: EmitOptions): string {
  const v = view(r);
  const p = o.prefix ?? 'eq';
  const name = (t: Token | string) => `--${p}-${typeof t === 'string' ? t : kebab(t.path)}`;
  const light = v.colors('light')!;
  const dark = v.colors('dark');
  const lines: string[] = [`/* ${HEADER} */`, dark ? '/* Light is the default. Dark follows prefers-color-scheme and can be forced with <html data-theme="dark|light">. */' : '/* Light only: the source has no dark theme. */', ':root {', `  color-scheme: ${dark ? 'light dark' : 'light'};`, '  /* color */'];
  for (const role of ROLES) lines.push(`  ${name(`color-${role}`)}: ${hexA(light[role])};`);
  const groups: [string, string][] = [['font', 'font'], ['space', 'space'], ['radius', 'radius'], ['shadow', 'shadow'], ['duration', 'motion'], ['easing', 'motion'], ['z', 'z-index']];
  for (const [g, title] of groups) {
    const ts = byPrefix(v.shape, g);
    if (!ts.length) continue;
    lines.push('', `  /* ${title} */`);
    for (const t of ts) lines.push(`  ${name(t)}: ${valueCss(t, v, p)};`);
  }
  const types = byPrefix(v.shape, 'type');
  if (types.length) {
    lines.push('', '  /* type roles: weight size/line-height family */');
    for (const t of types) {
      lines.push(`  ${name(t)}: ${valueCss(t, v, p)};`, `  ${name(t)}-tracking: ${trim(typo(t).tracking)}em;`);
    }
  }
  lines.push('}');
  if (dark) {
    const diff = ROLES.filter((role) => hexA(dark[role]) !== hexA(light[role]));
    const body = (ind: string) => diff.map((role) => `${ind}${name(`color-${role}`)}: ${hexA(dark[role])};`);
    lines.push('', '@media (prefers-color-scheme: dark) {', '  :root:not([data-theme="light"]) {', ...body('    '), '  }', '}', ':root[data-theme="light"] { color-scheme: light; }', ':root[data-theme="dark"] {', '  color-scheme: dark;', ...body('  '), '}');
  }
  return lines.join('\n') + '\n';
}
