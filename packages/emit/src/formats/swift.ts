import { ROLES } from '@equipe-design/remix';
import { HEADER, byPrefix, camel, pascal, shadows, stepOf, trim, typo, view, type EmitOptions } from './common.ts';
import type { Resolved, Rgba } from '../tokens.ts';

const swiftWeight = (w: number) => (w >= 800 ? '.heavy' : w >= 700 ? '.bold' : w >= 600 ? '.semibold' : w >= 500 ? '.medium' : w <= 300 ? '.light' : '.regular');
const ident = (s: string) => (/^\d/.test(s) ? 'n' + s : s);

/** SwiftUI: colour roles (light / dark), space, radius, type styles, shadows, motion. Checked with `swiftc -typecheck`. */
export function swift(r: Resolved, o: EmitOptions): string {
  const v = view(r);
  const P = o.typePrefix ?? pascal(o.prefix ?? 'eq');
  const col = (c: Rgba) => (c.a === 1 ? `Color(0x${c.hex.slice(1).toUpperCase()})` : `Color(0x${c.hex.slice(1).toUpperCase()}, ${trim(c.a)})`);
  const light = v.colors('light')!;
  const dark = v.colors('dark');
  const roleName = (role: string) => camel(role);
  const out: string[] = [
    `// ${HEADER}`,
    'import SwiftUI', '',
    'private extension Color {',
    '    init(_ rgb: UInt32, _ alpha: Double = 1) { self.init(.sRGB, red: Double((rgb >> 16) & 255) / 255, green: Double((rgb >> 8) & 255) / 255, blue: Double(rgb & 255) / 255, opacity: alpha) }',
    '}', '',
    `public struct ${P}TextStyle {`, '    public let size: CGFloat', '    public let lineHeight: CGFloat', '    public let weight: Font.Weight', '    public let trackingEm: CGFloat', '    public let monospaced: Bool',
    '    public var font: Font { .system(size: size, weight: weight, design: monospaced ? .monospaced : .default) }', '}',
    `public struct ${P}Shadow { public let x: CGFloat, y: CGFloat, blur: CGFloat, spread: CGFloat; public let color: Color }`, '',
    `public struct ${P}Colors {`,
    ...ROLES.map((role) => `    public let ${roleName(role)}: Color`),
    `    public static let light = ${P}Colors(`, ROLES.map((role) => `        ${roleName(role)}: ${col(light[role])}`).join(',\n'), '    )',
    dark
      ? `    public static let dark = ${P}Colors(\n${ROLES.map((role) => `        ${roleName(role)}: ${col(dark[role])}`).join(',\n')}\n    )`
      : '    /// The source has no dark theme, so dark mode uses the light colours.\n    public static let dark = light',
    `    public static func resolved(_ scheme: ColorScheme) -> ${P}Colors { scheme == .dark ? .dark : .light }`, '}', '',
  ];
  const enumBlock = (name: string, rows: string[]) => out.push(`public enum ${P}${name} {`, ...rows.map((x) => '    ' + x), '}', '');
  const space = byPrefix(v.shape, 'space');
  if (space.length) enumBlock('Space', space.map((t) => `public static let s${stepOf(t)}: CGFloat = ${trim(t.value as number)}`));
  const rad = byPrefix(v.shape, 'radius');
  if (rad.length) enumBlock('Radius', rad.map((t) => `public static let ${ident(stepOf(t))}: CGFloat = ${trim(t.value as number)}`));
  const types = byPrefix(v.shape, 'type');
  if (types.length) {
    enumBlock('Type', types.map((t) => {
      const x = typo(t);
      return `public static let ${ident(stepOf(t))} = ${P}TextStyle(size: ${trim(x.size)}, lineHeight: ${trim(x.line)}, weight: ${swiftWeight(x.weight)}, trackingEm: ${trim(x.tracking)}, monospaced: ${x.mono})`;
    }));
  }
  const sh = byPrefix(v.shape, 'shadow');
  if (sh.length) {
    enumBlock('Shadows', sh.map((t) => `public static let s${stepOf(t)}: [${P}Shadow] = [` + shadows(t).map((s) => `${P}Shadow(x: ${trim(s.x)}, y: ${trim(s.y)}, blur: ${trim(s.blur)}, spread: ${trim(s.spread)}, color: ${col(s.color)})`).join(', ') + ']'));
  }
  const fam = byPrefix(v.shape, 'font.family');
  if (fam.length) enumBlock('FontFamily', fam.map((t) => `/// First choice; apps fall back to the platform font.\n    public static let ${ident(stepOf(t))} = "${(t.value as string[])[0]}"`));
  const dur = byPrefix(v.shape, 'duration');
  const ease = byPrefix(v.shape, 'easing');
  if (dur.length || ease.length) {
    enumBlock('Motion', [
      ...dur.map((t) => `/// seconds (${trim(t.value as number)} ms)\n    public static let duration${pascal(stepOf(t))}: TimeInterval = ${trim((t.value as number) / 1000)}`),
      ...ease.map((t) => { const b = t.value as number[]; return `public static func ease${pascal(stepOf(t))}(_ duration: TimeInterval) -> Animation { Animation.timingCurve(${b.join(', ')}, duration: duration) }`; }),
    ]);
  }
  const z = byPrefix(v.shape, 'z');
  if (z.length) enumBlock('Layer', z.map((t) => `public static let l${stepOf(t)}: Int = ${t.value as number}`));
  return out.join('\n');
}
