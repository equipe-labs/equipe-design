import { Ajv2020 } from 'ajv/dist/2020.js';
import schema from '../extract-0.1.schema.json' with { type: 'json' };
import { findForbiddenContent, type ContentViolation } from './forbidden.ts';
import { findDanglingReferences, type ReferenceError } from './references.ts';
import type { Extraction } from './types.ts';

export type * from './types.ts';
export type { ContentViolation, ReferenceError };
export { findForbiddenContent, findDanglingReferences, schema };

export const SCHEMA_VERSION = '0.1';

export interface ValidationIssue {
  kind: 'schema' | 'content' | 'reference';
  path: string;
  message: string;
}

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateSchema = ajv.compile(schema);

/** Checks shape (JSON Schema), forbidden content (CSS text, url(), @font-face…) and id references. */
export function validateExtraction(value: unknown): { ok: true; value: Extraction } | { ok: false; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  const shapeOk = validateSchema(value);
  if (!shapeOk) {
    for (const e of validateSchema.errors ?? []) {
      issues.push({ kind: 'schema', path: e.instancePath || '/', message: e.message ?? e.keyword });
    }
  }
  for (const v of findForbiddenContent(value)) {
    issues.push({ kind: 'content', path: v.path, message: `${v.rule}: ${v.excerpt}` });
  }
  if (shapeOk) {
    for (const r of findDanglingReferences(value as unknown as Extraction)) {
      issues.push({ kind: 'reference', path: r.path, message: `unknown id ${r.id}` });
    }
  }
  return issues.length ? { ok: false, issues } : { ok: true, value: value as unknown as Extraction };
}
