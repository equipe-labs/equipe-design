// Results carry values only (README 3장 "원문 CSS 저장 금지"). This walks every key and
// string in a result and flags anything that looks like copied CSS, a font-face rule or
// an asset reference. Prose in `reasons` never needs braces or declarations either.

export interface ContentViolation {
  path: string;
  rule: string;
  excerpt: string;
}

const RULES: { rule: string; test: RegExp }[] = [
  { rule: 'css-block', test: /[{}]/ },
  { rule: 'css-declaration', test: /[a-z-]+\s*:\s*[^;:]+;/i },
  { rule: 'url()', test: /url\s*\(/i },
  { rule: '@font-face', test: /@font-face/i },
  { rule: '@import', test: /@import/i },
  { rule: 'data-uri', test: /data:[a-z]+\/[a-z0-9.+-]+[;,]/i },
  { rule: 'font-file', test: /\.(woff2?|ttf|otf|eot)\b/i },
];

// `$comment` is a note for people reading the example files, not engine output.
const SKIP_KEYS = new Set(['$comment']);

export function findForbiddenContent(value: unknown, path = ''): ContentViolation[] {
  const out: ContentViolation[] = [];
  const check = (s: string, at: string) => {
    for (const { rule, test } of RULES) {
      if (test.test(s)) out.push({ path: at || '/', rule, excerpt: s.slice(0, 80) });
    }
  };
  if (typeof value === 'string') {
    check(value, path);
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => out.push(...findForbiddenContent(v, `${path}/${i}`)));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (SKIP_KEYS.has(k)) continue;
      const at = `${path}/${k}`;
      check(k, at);
      out.push(...findForbiddenContent(v, at));
    }
  }
  return out;
}
