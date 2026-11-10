import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['library/test/**/*.test.ts'] },
});
