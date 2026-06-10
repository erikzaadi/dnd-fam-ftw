import { defineConfig, devices } from '@playwright/test';

// Self-contained config for generating README screenshots into docs/.
// Boots its own backend (with a throwaway seeded SQLite and mocked AI)
// and frontend, so no running dev server or API keys are needed.

const DB_PATH = '/tmp/dnd-fam-ftw-readme-screenshots.sqlite';
const IMAGE_PATH = '/tmp/dnd-fam-ftw-readme-screenshots-images';
const BACKEND_PORT = 3102;
const FRONTEND_PORT = 5175;

const backendEnv = [
  `SQLITE_DB_PATH=${DB_PATH}`,
  `LOCAL_IMAGE_STORAGE_PATH=${IMAGE_PATH}`,
  'LOCAL_IMAGE_PUBLIC_BASE_URL=/test-images',
  'IMAGE_STORAGE_PROVIDER=local',
  'TEST_AI_MOCK=true',
  'OPENAI_API_KEY=readme-screenshots-key',
  `PORT=${BACKEND_PORT}`,
].join(' ');

export default defineConfig({
  testDir: './tests',
  testMatch: 'readme-screenshots.spec.ts',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${FRONTEND_PORT}`,
  },
  webServer: [
    {
      command: `rm -f ${DB_PATH} && ${backendEnv} npm exec -- tsx src/scripts/cli.ts sessions seed && ${backendEnv} npm exec -- tsx src/index.ts`,
      cwd: '../backend',
      url: `http://localhost:${BACKEND_PORT}/health`,
      timeout: 120_000,
      reuseExistingServer: false,
    },
    {
      command: `VITE_API_PROXY_TARGET=http://localhost:${BACKEND_PORT} npm run dev -- --host 127.0.0.1 --port ${FRONTEND_PORT}`,
      url: `http://localhost:${FRONTEND_PORT}`,
      timeout: 120_000,
      reuseExistingServer: false,
    },
  ],
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
