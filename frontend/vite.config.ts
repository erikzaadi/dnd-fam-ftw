import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { audioCatalogPlugin } from './plugins/audioCatalogPlugin'

// https://vite.dev/config/
// VITE_BASE_PATH: '/' for dev and AWS (default), '/dnd-fam-ftw/' for local laptop builds (scripts/re-deploy.sh)
const BASE = process.env.VITE_BASE_PATH ?? '/';
const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  base: BASE,
  plugins: [
    react(),
    tailwindcss(),
    audioCatalogPlugin(join(__dirname, 'public'), BASE),
  ],
  server: {
    proxy: {
      [`${BASE}api`]: {
        target: 'http://localhost:3001',
        changeOrigin: true,
        rewrite: (path) => path.slice(`${BASE}api`.length),
      },
    },
  },
})
