import { defineConfig, devices } from '@playwright/test';

const DB_PATH = '/tmp/dnd-fam-ftw-e2e.sqlite';
const IMAGE_PATH = '/tmp/dnd-fam-ftw-e2e-images';
const BACKEND_PORT = 3101;
const FRONTEND_PORT = 5174;

const backendEnv = [
  `SQLITE_DB_PATH=${DB_PATH}`,
  `LOCAL_IMAGE_STORAGE_PATH=${IMAGE_PATH}`,
  'LOCAL_IMAGE_PUBLIC_BASE_URL=/test-images',
  'IMAGE_STORAGE_PROVIDER=local',
  'TEST_AI_MOCK=true',
  'NARRATION_WORKFLOW=monolith',
  'OPENAI_API_KEY=e2e-test-key',
  `PORT=${BACKEND_PORT}`,
].join(' ');

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['list']] : 'html',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${FRONTEND_PORT}`,
    trace: 'on-first-retry',
  },
  webServer: [
    {
      command: `${backendEnv} npm exec -- tsx src/scripts/cli.ts sessions seed && ${backendEnv} npm exec -- tsx watch src/index.ts`,
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
