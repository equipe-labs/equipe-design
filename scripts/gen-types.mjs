// Generates packages/schema/src/types.ts from the JSON Schema, so the schema stays the
// single source. `--check` fails when the committed file is out of date (CI lint).
import { readFile, writeFile } from 'node:fs/promises';
import { compile } from 'json-schema-to-typescript';

const root = new URL('../packages/schema/', import.meta.url);
const schema = JSON.parse(await readFile(new URL('extract-0.1.schema.json', root), 'utf8'));
const out = new URL('src/types.ts', root);

const ts = await compile(schema, 'Extraction', {
  bannerComment: '// Generated from extract-0.1.schema.json by `npm run gen:types`. Do not edit.',
  additionalProperties: false,
  unreachableDefinitions: false,
  maxItems: -1,
  style: { singleQuote: true, printWidth: 100 },
});

if (process.argv.includes('--check')) {
  const current = await readFile(out, 'utf8').catch(() => '');
  if (current !== ts) {
    console.error('packages/schema/src/types.ts is out of date: run `npm run gen:types`');
    process.exit(1);
  }
} else {
  await writeFile(out, ts);
}
