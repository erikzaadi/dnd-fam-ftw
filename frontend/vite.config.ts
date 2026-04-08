import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
const BASE = '/dnd-fam-ftw/';

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
        rewrite: (path) => path.replace(/^\/dnd-fam-ftw/, ''),
      },
    },
  },
})
