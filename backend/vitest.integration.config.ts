import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    pool: 'forks',
    include: ['src/tests/integration/**/*.test.ts'],
    reporters: ['verbose', 'github-actions'],
  },
});
