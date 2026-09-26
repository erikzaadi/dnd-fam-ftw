import { fileURLToPath } from 'url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Run against shared source so a stale packages/shared/dist never leaks into tests.
    alias: { '@dnd-fam-ftw/shared': fileURLToPath(new URL('../packages/shared/src/index.ts', import.meta.url)) },
  },
  test: {
    pool: 'forks',
    include: ['src/**/*.test.ts'],
    exclude: ['src/tests/integration/**/*.test.ts'],
  },
});
