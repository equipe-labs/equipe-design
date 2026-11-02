import { bestOn, normalizeHex, toOklch, type RoleName } from '@equipe-design/remix';
import { HEADER, trim, view, type EmitOptions } from './common.ts';
import type { Resolved, Rgba } from '../tokens.ts';

function hsl(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  return `${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}
function oklchCss(hex: string): string {
  const o = toOklch(hex);
  return `oklch(${trim(Math.round(o.l * 1000) / 1000)} ${trim(Math.round(o.c * 1000) / 1000)} ${trim(Math.round(o.h * 10) / 10)})`;
}

/**
 * shadcn/ui theme variables. Every value comes from a colour *role* (background, text …),
 * never from the most frequent colour on a page — that mix-up gave designlang a grey `--background`.
 */
export function shadcn(r: Resolved, o: EmitOptions): string {
  const v = view(r);
  const fmt = o.shadcnFormat ?? 'oklch';
  const conv = (hex: string) => (fmt === 'hsl' ? hsl(hex) : oklchCss(hex));
  const map = (c: Record<RoleName, Rgba>): [string, string][] => {
    const h = (role: RoleName) => normalizeHex(c[role].hex);
    return [
      ['background', h('background')], ['foreground', h('text')],
      ['card', h('surface')], ['card-foreground', h('text')],
      ['popover', h('raised')], ['popover-foreground', h('text')],
      ['primary', h('primary')], ['primary-foreground', h('on-primary')],
      ['secondary', h('secondary')], ['secondary-foreground', h('text')],
      ['muted', h('surface')], ['muted-foreground', h('muted-text')],
      ['accent', h('secondary')], ['accent-foreground', h('text')],
      ['destructive', h('destructive')], ['destructive-foreground', bestOn(h('destructive'))],
      ['border', h('border')], ['input', h('border-strong')], ['ring', h('ring')],
      ['chart-1', h('accent')], ['chart-2', h('success')], ['chart-3', h('warning')], ['chart-4', h('destructive')], ['chart-5', h('primary')],
    ];
  };
  const block = (sel: string, c: Record<RoleName, Rgba>, extra: string[] = []) => [`${sel} {`, ...map(c).map(([k, val]) => `  --${k}: ${conv(val)};`), ...extra, '}'];
  const md = v.find(v.light, 'radius.md')?.value as number | undefined;
  const lines = [
    `/* ${HEADER} */`,
    '/* shadcn/ui theme. shadcn\'s `accent` is the hover surface, so it takes the secondary role; the brand colour is `primary`. */',
    ...block(':root', v.colors('light')!, [`  --radius: ${trim((md ?? 8) / 16)}rem;`]),
  ];
  const dark = v.colors('dark');
  if (dark) lines.push('', ...block('.dark', dark));
  const names = map(v.colors('light')!).map(([k]) => k);
  const wrap = (k: string) => (fmt === 'hsl' ? `hsl(var(--${k}))` : `var(--${k})`);
  lines.push('', '@theme inline {', ...names.map((k) => `  --color-${k}: ${wrap(k)};`), '  --radius-sm: calc(var(--radius) - 4px);', '  --radius-md: calc(var(--radius) - 2px);', '  --radius-lg: var(--radius);', '  --radius-xl: calc(var(--radius) + 4px);', '}');
  return lines.join('\n') + '\n';
}
