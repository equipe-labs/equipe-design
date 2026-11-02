import { defineConfig } from 'vitest/config';

// Not part of the root `npm test` (packages only): run with `npx vitest run -c eval/vitest.config.ts`.
export default defineConfig({
  test: { root: new URL('.', import.meta.url).pathname, include: ['test/**/*.test.ts'] },
});
