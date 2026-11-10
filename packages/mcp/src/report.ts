import type { Extraction } from '@equipe-design/schema';

/** One line for an agent: what was found, how much is missing. */
export function summaryLine(x: Extraction, opts: { fake?: boolean } = {}): string {
  const s = x.summary;
  const parts = x.run.stoppedBy
    ? [`stopped: ${x.run.stoppedBy}, nothing read`]
    : [
        `${s.colors} colors`,
        `roles ${s.roles.filled} filled / ${s.roles.empty} empty`,
        `brand ${s.brand ?? 'not inferred'}`,
        `${s.darkPairs} dark pairs`,
        `${s.components} components`,
      ];
  parts.push(`${s.limits} limits`);
  if (s.lowConfidence.length) parts.push(`low confidence: ${s.lowConfidence.slice(0, 3).join(', ')}`);
  return `${opts.fake ? 'FAKE ENGINE (example data, not measured): ' : ''}${x.source.pages.length} page(s); ${parts.join('; ')}`;
}

/** report.md: what was read, the summary, and every limit with its fix. */
export function renderReport(x: Extraction, opts: { fake?: boolean } = {}): string {
  const lines = [
    '# Extraction report',
    '',
    ...(opts.fake ? ['> Made by the fake engine from a schema example. Values are not measured.', ''] : []),
    summaryLine(x, opts),
    '',
    '## Pages',
    ...x.source.pages.map((p) => `- ${p.url} (status ${p.status ?? '–'}, robots ${p.robots.allowed ? 'allowed' : 'disallowed'})`),
    '',
    '## Limits',
    ...(x.limits.length
      ? x.limits.map((l) => `- **${l.kind}** (${l.scope}): ${l.reason}. ${l.effect}.${l.fix ? ` Fix: ${l.fix}.` : ''}`)
      : ['- none']),
    '',
    x.notice,
    '',
  ];
  return lines.join('\n');
}
