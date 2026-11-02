import type { Extraction } from '@equipe-design/schema';

// report.md (README 2.9): the one page people and the designer read first. Evidence is
// given as selectors and coordinates only; no screenshots.

const esc = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');

export function report(x: Extraction): string {
  const hex = new Map(x.observed.color.map((c) => [c.id, c.value.hex + (c.value.alpha < 1 ? ` (α ${c.value.alpha})` : '')]));
  const h = (id: string | null | undefined) => (id ? `\`${hex.get(id) ?? id}\`` : '—');
  const out: string[] = [];
  const page0 = x.source.pages[0]!;
  out.push(`# 추출 리포트 — ${new URL(page0.url).host || page0.url}`, '');
  out.push(`${x.notice}`, '');
  out.push(`- 실행: ${x.run.startedAt} · ${(x.run.durationMs / 1000).toFixed(1)}초 · equipe-design ${x.tool.version}${x.tool.chrome ? ` · Chrome ${x.tool.chrome}` : ''}`);
  out.push(`- 페이지: ${x.source.pages.map((p) => p.url).join(', ')}`);
  out.push(`- 폭 ${x.run.options.widths.join('·')}px · 모드 ${x.run.options.modes} · 상태 강제 ${x.run.options.states ? '켬' : '끔'}`, '');

  if (x.run.stoppedBy) {
    const l = x.limits.find((l) => l.kind === x.run.stoppedBy);
    out.push('## 멈춤', '', `가드레일 **${x.run.stoppedBy}** 때문에 값을 하나도 읽지 않았어요.`, '');
    if (l) out.push(`- 이유: ${l.reason}`, `- 고치는 법: ${l.fix ?? '—'}`, '');
    out.push(...guardrails(x));
    return out.join('\n') + '\n';
  }

  // ① 한 줄 결과
  const s = x.summary;
  const brand = x.inferred.brand;
  const brandText = brand?.status === 'found' ? `${h(brand.color)} (found)` : brand?.status === 'uncertain' ? `불확실 — 후보 ${brand.candidates.slice(0, 3).map((c) => h(c.color)).join(', ')}` : '없음(none)';
  out.push('## 한 줄 결과', '');
  out.push(`역할 ${s.roles.filled}/${s.roles.filled + s.roles.empty}개 채움 · 브랜드색 ${brandText} · 다크 쌍 ${s.darkPairs}개 · 색 ${s.colors}개 · 컴포넌트 ${s.components}종 · 한계 ${s.limits}개`, '');
  const modes = x.source.modes;
  out.push(`- 라이트: ${modes.light.observed ? `읽음(${modes.light.method})` : '못 읽음'} · 다크: ${modes.dark.observed ? `읽음(${modes.dark.method})` : '못 읽음'}`);
  const sc = x.inferred.scales;
  if (sc?.spacing) out.push(`- 간격: ${sc.spacing.steps.join(' · ')}px (기준 ${sc.spacing.base?.value}px, 적합도 ${sc.spacing.fit})`);
  if (sc?.radius) out.push(`- 반경: ${sc.radius.steps.join(' · ')}px${sc.radius.full ? ' + full' : ''}`);
  if (sc?.fontSize) out.push(`- 글자 크기: ${sc.fontSize.steps.join(' · ')}px${sc.fontSize.ratio ? ` (비율 ${sc.fontSize.ratio})` : ''}`);
  const fams = x.observed.typography.families.slice(0, 4);
  if (fams.length) out.push(`- 글꼴: ${fams.map((f) => `${f.name} (${f.license}${f.oflAlternatives.length ? `, 대체 ${f.oflAlternatives.join('/')}` : ''})`).join(', ')}`);
  out.push('');

  // roles
  if (x.inferred.roles?.length) {
    out.push('### 역할', '', '| 역할 | 라이트 | 다크 | 신뢰도 | 이유 |', '|---|---|---|---|---|');
    for (const r of x.inferred.roles) out.push(`| ${r.role} | ${h(r.light)} | ${h(r.dark)} | ${r.confidence} | ${esc(r.reasons.join('; '))} |`);
    out.push('');
  }
  if (brand) {
    out.push('### 브랜드색 판정', '');
    for (const r of brand.reasons) out.push(`- ${r}`);
    out.push('');
  }
  if (x.inferred.components?.length) {
    out.push('### 컴포넌트', '', '| id | 종류 | 변형 | 상태(hover·focus·active·disabled) |', '|---|---|---|---|');
    for (const c of x.inferred.components) {
      for (const v of c.variants) {
        const st = (['hover', 'focus-visible', 'active', 'disabled'] as const).map((k) => (v.states[k].observed ? '✓' : '·')).join(' ');
        out.push(`| ${v.id} | ${c.kind} | ${v.suggestedName} ×${v.count} — 배경 ${h(v.fingerprint.background)}, 글자 ${h(v.fingerprint.color)}${v.fingerprint.radius ? `, 반경 ${v.fingerprint.radius.value}px` : ''}${v.fingerprint.height ? `, 높이 ${v.fingerprint.height.value}px` : ''} | ${st} |`);
      }
    }
    out.push('');
  }

  // ② 신뢰도 낮은 항목
  out.push('## 신뢰도 낮은 항목', '');
  if (s.lowConfidence.length) for (const p of s.lowConfidence) out.push(`- \`${p}\``);
  else out.push('- 없음');
  out.push('');

  // ③ limits
  out.push('## 못 본 것 (limits)', '', '| id | 종류 | 범위 | 이유 | 영향 | 고치는 법 |', '|---|---|---|---|---|---|');
  for (const l of x.limits) out.push(`| ${l.id} | ${l.kind} | \`${esc(l.scope)}\` | ${esc(l.reason)} | ${esc(l.effect)} | ${esc(l.fix ?? '—')} |`);
  out.push('');

  // ④ 버린 잡값
  out.push('## 단계에서 뺀 값 (잡값)', '');
  for (const [name, scale] of [['간격', sc?.spacing], ['반경', sc?.radius]] as const) {
    if (!scale?.outliers?.length) continue;
    out.push(`- ${name}: ${scale.outliers.slice(0, 12).map((o) => `${o.value}px×${o.count}(${o.reason})`).join(', ')}`);
  }
  out.push('');

  // evidence samples for the main roles
  out.push('## 근거 샘플', '');
  for (const r of (x.inferred.roles ?? []).filter((r) => ['background', 'text', 'primary', 'accent', 'border'].includes(r.role))) {
    const id = r.light ?? r.dark;
    const c = x.observed.color.find((c) => c.id === id);
    if (!c?.evidence.length) continue;
    out.push(`- ${r.role} ${h(id)}: ${c.evidence.slice(0, 3).map((e) => `\`${esc(e.selector)}\` ${e.prop} @${e.width}px [${e.rect.join(',')}]`).join('; ')}`);
  }
  out.push('');
  out.push(...guardrails(x));
  return out.join('\n') + '\n';
}

function guardrails(x: Extraction): string[] {
  const g = x.guardrails;
  return [
    '## 지킨 가드레일',
    '',
    `- robots.txt: ${g.robots} (UA \`${x.run.userAgent}\`)`,
    `- 로그인 안 함, 새 임시 브라우저 프로필 · 페이지 ${g.pagesVisited}/${g.maxPages}개`,
    `- GET·HEAD 외 요청 ${g.mutatingRequestsBlocked}건 차단`,
    '- 저장 안 함: CSS 원문 · 폰트 파일 · 이미지 · 본문 텍스트 · 스크린샷',
    '',
  ];
}
