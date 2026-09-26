import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { join } from 'path';
import { audioCatalogPlugin } from './plugins/audioCatalogPlugin';

export default defineConfig({
  plugins: [react(), audioCatalogPlugin(join(__dirname, 'public'))],
  resolve: {
    // Run against shared source so a stale packages/shared/dist never leaks into tests.
    alias: { '@dnd-fam-ftw/shared': join(__dirname, '../packages/shared/src/index.ts') },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
