import { ROLES } from '@equipe-design/remix';
import { HEADER, byPrefix, camel, pascal, shadows, stepOf, trim, typo, view, type EmitOptions } from './common.ts';
import type { Resolved, Rgba } from '../tokens.ts';

const kWeight = (w: number) => (w >= 800 ? 'FontWeight.ExtraBold' : w >= 700 ? 'FontWeight.Bold' : w >= 600 ? 'FontWeight.SemiBold' : w >= 500 ? 'FontWeight.Medium' : w <= 300 ? 'FontWeight.Light' : 'FontWeight.Normal');
const ident = (s: string) => (/^\d/.test(s) ? 'n' + s : s);

/** Jetpack Compose: colour roles (light / dark), space, radius, type styles, shadows, motion. */
export function kotlin(r: Resolved, o: EmitOptions): string {
  const v = view(r);
  const P = o.typePrefix ?? pascal(o.prefix ?? 'eq');
  const pkg = o.kotlinPackage ?? 'design.tokens';
  const col = (c: Rgba) => `Color(0x${Math.round(c.a * 255).toString(16).padStart(2, '0').toUpperCase()}${c.hex.slice(1).toUpperCase()})`;
  const light = v.colors('light')!;
  const dark = v.colors('dark');
  const out: string[] = [
    `// ${HEADER}`, `package ${pkg}`, '',
    'import androidx.compose.animation.core.CubicBezierEasing',
    'import androidx.compose.runtime.Immutable',
    'import androidx.compose.ui.graphics.Color',
    'import androidx.compose.ui.text.TextStyle',
    'import androidx.compose.ui.text.font.FontFamily',
    'import androidx.compose.ui.text.font.FontWeight',
    'import androidx.compose.ui.unit.Dp', 'import androidx.compose.ui.unit.TextUnit', 'import androidx.compose.ui.unit.dp', 'import androidx.compose.ui.unit.em', 'import androidx.compose.ui.unit.sp', '',
    '@Immutable',
    `public class ${P}TextStyle(public val size: TextUnit, public val lineHeight: TextUnit, public val weight: FontWeight, public val trackingEm: Float, public val mono: Boolean) {`,
    '    /** The platform font: brand fonts are not bundled in the app. */',
    '    public fun toTextStyle(): TextStyle = TextStyle(fontSize = size, lineHeight = lineHeight, fontWeight = weight, letterSpacing = trackingEm.em, fontFamily = if (mono) FontFamily.Monospace else FontFamily.Default)',
    '}',
    '@Immutable', `public class ${P}Shadow(public val x: Dp, public val y: Dp, public val blur: Dp, public val spread: Dp, public val color: Color)`, '',
    '@Immutable', `public class ${P}Colors(`, ROLES.map((role) => `    public val ${camel(role)}: Color`).join(',\n'), ') {', '    public companion object {',
    `        public val Light: ${P}Colors = ${P}Colors(`, ROLES.map((role) => `            ${camel(role)} = ${col(light[role])}`).join(',\n'), '        )',
    dark
      ? `        public val Dark: ${P}Colors = ${P}Colors(\n${ROLES.map((role) => `            ${camel(role)} = ${col(dark[role])}`).join(',\n')}\n        )`
      : '        /** The source has no dark theme, so dark mode uses the light colours. */\n        public val Dark: ' + `${P}Colors = Light`,
    '    }', '}', '',
  ];
  const obj = (name: string, rows: string[]) => out.push(`public object ${P}${name} {`, ...rows.map((x) => '    ' + x), '}', '');
  const space = byPrefix(v.shape, 'space');
  if (space.length) obj('Space', space.map((t) => `public val s${stepOf(t)}: Dp = ${trim(t.value as number)}.dp`));
  const rad = byPrefix(v.shape, 'radius');
  if (rad.length) obj('Radius', rad.map((t) => `public val ${ident(stepOf(t))}: Dp = ${trim(t.value as number)}.dp`));
  const types = byPrefix(v.shape, 'type');
  if (types.length) {
    obj('Type', types.map((t) => {
      const x = typo(t);
      return `public val ${ident(stepOf(t))}: ${P}TextStyle = ${P}TextStyle(${trim(x.size)}.sp, ${trim(x.line)}.sp, ${kWeight(x.weight)}, ${trim(x.tracking)}f, ${x.mono})`;
    }));
  }
  const sh = byPrefix(v.shape, 'shadow');
  if (sh.length) obj('Shadows', sh.map((t) => `public val s${stepOf(t)}: List<${P}Shadow> = listOf(` + shadows(t).map((s) => `${P}Shadow(${trim(s.x)}.dp, ${trim(s.y)}.dp, ${trim(s.blur)}.dp, ${trim(s.spread)}.dp, ${col(s.color)})`).join(', ') + ')'));
  const dur = byPrefix(v.shape, 'duration');
  const ease = byPrefix(v.shape, 'easing');
  if (dur.length || ease.length) {
    obj('Motion', [
      ...dur.map((t) => `/** milliseconds */\n    public const val duration${pascal(stepOf(t))}: Int = ${Math.round(t.value as number)}`),
      ...ease.map((t) => `public val ease${pascal(stepOf(t))}: CubicBezierEasing = CubicBezierEasing(${(t.value as number[]).map((n) => n + 'f').join(', ')})`),
    ]);
  }
  const z = byPrefix(v.shape, 'z');
  if (z.length) obj('Layer', z.map((t) => `public const val l${stepOf(t)}: Int = ${t.value as number}`));
  return out.join('\n');
}
