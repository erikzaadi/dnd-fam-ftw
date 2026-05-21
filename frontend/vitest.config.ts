import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { join } from 'path';
import { audioCatalogPlugin } from './plugins/audioCatalogPlugin';

export default defineConfig({
  plugins: [react(), audioCatalogPlugin(join(__dirname, 'public'))],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
