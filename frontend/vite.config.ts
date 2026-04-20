import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
// VITE_BASE_PATH: '/' for dev and AWS (default), '/dnd-fam-ftw/' for local laptop builds (scripts/re-deploy.sh)
const BASE = process.env.VITE_BASE_PATH ?? '/';

export default defineConfig({
  base: BASE,
  plugins: [
    react(),
    tailwindcss(),
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
