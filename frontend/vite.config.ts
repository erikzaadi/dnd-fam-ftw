import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
// VITE_BASE_PATH: '/' for AWS (root domain), '/dnd-fam-ftw/' for local/legacy deployment
const BASE = process.env.VITE_BASE_PATH ?? '/dnd-fam-ftw/';

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
        rewrite: (path) => path.replace(/^\/dnd-fam-ftw\/api/, ''),
      },
      [`${BASE}images`]: {
        target: 'http://localhost:3001',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/dnd-fam-ftw/, ''),
      },
    },
  },
})
