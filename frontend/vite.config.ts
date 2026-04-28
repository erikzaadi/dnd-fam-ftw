import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { audioCatalogPlugin } from './plugins/audioCatalogPlugin'

// https://vite.dev/config/
// VITE_BASE_PATH: '/' for dev and AWS (default), '/dnd-fam-ftw/' for local laptop builds (scripts/re-deploy.sh)
const DEPLOY_BASE = process.env.VITE_BASE_PATH ?? '/';
const __dirname = dirname(fileURLToPath(import.meta.url));

type FaviconDragon = 'green' | 'red' | 'blue';

const dragonFromEnv = (command: 'build' | 'serve', base: string): FaviconDragon => {
  const requested = process.env.VITE_FAVICON_DRAGON;
  if (requested === 'green' || requested === 'red' || requested === 'blue') {
    return requested;
  }

  if (command === 'serve') {
    return 'red';
  }

  return base === '/dnd-fam-ftw/' ? 'blue' : 'green';
};

const dragonFilters: Record<FaviconDragon, string> = {
  green: '',
  red: 'filter: hue-rotate(-120deg) saturate(2);',
  blue: 'filter: hue-rotate(120deg) saturate(1.8);',
};

const faviconHref = (dragon: FaviconDragon) => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90" style="${dragonFilters[dragon]}">🐉</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
};

const faviconPlugin = (dragon: FaviconDragon): Plugin => ({
  name: 'dragon-favicon',
  transformIndexHtml(html) {
    return html.replace('%DRAGON_FAVICON_HREF%', faviconHref(dragon));
  },
});

export default defineConfig(({ command }) => {
  const base = command === 'serve' ? '/' : DEPLOY_BASE;
  const faviconDragon = dragonFromEnv(command, base);

  return {
    base,
    plugins: [
      react(),
      tailwindcss(),
      audioCatalogPlugin(join(__dirname, 'public'), base),
      faviconPlugin(faviconDragon),
    ],
    server: {
      proxy: {
        [`${base}api`]: {
          target: 'http://localhost:3001',
          changeOrigin: true,
          rewrite: (path) => path.slice(`${base}api`.length),
        },
      },
    },
  };
})
