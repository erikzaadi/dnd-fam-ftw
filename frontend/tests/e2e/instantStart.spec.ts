import { expect, test } from '@playwright/test';
import { dismissAudioOverlay } from './helpers';

test.beforeEach(async ({ request }) => {
  // Disable images so the background flow uses instant_start_ready (savings mode path)
  // instead of waiting for preview_image_available which requires a real OpenAI key.
  await request.post('/api/settings', { data: { imagesEnabled: false } });
});

test.afterEach(async ({ request }) => {
  await request.post('/api/settings', { data: { imagesEnabled: true } });
});

test('instant start: loader appears and navigates to a new session', async ({ page }) => {
  const consoleMsgs: string[] = [];
  page.on('console', msg => consoleMsgs.push(`[${msg.type()}] ${msg.text()}`));

  await page.goto('/');
  await dismissAudioOverlay(page);

  await expect(page.getByRole('button', { name: /Quick Start/i })).toBeVisible();

  // Wait for the POST and inspect what it returns
  const [response] = await Promise.all([
    page.waitForResponse(res => res.url().includes('/session/instant-start') && res.request().method() === 'POST', { timeout: 10_000 }),
    page.getByRole('button', { name: /Quick Start/i }).click(),
  ]);

  const status = response.status();
  const body = await response.json().catch(() => null) as { id?: string } | null;
  expect(status, `POST /session/instant-start returned ${status}: ${JSON.stringify(body)}\nConsole:\n${consoleMsgs.join('\n')}`).toBe(200);
  expect(body?.id, 'Response missing id').toBeTruthy();

  // Should navigate to a session page immediately after POST resolves
  await expect(page).toHaveURL(/\/session\//, { timeout: 60_000 });

  // Session page should load with an action dock
  await dismissAudioOverlay(page);
  await expect(page.getByText('Choose an Action')).toBeVisible({ timeout: 30_000 });
});

test('instant start: POST returns quickly without blocking on AI work', async ({ request }) => {
  const start = Date.now();
  const res = await request.post('/api/session/instant-start');
  const elapsed = Date.now() - start;

  expect(res.ok()).toBe(true);
  const body = await res.json() as { id: string; savingsMode: boolean };
  expect(typeof body.id).toBe('string');
  expect(body.id.length).toBeGreaterThan(0);

  // Should respond well within 5s - session creation is synchronous, AI work is background
  expect(elapsed).toBeLessThan(5_000);
});

test('instant start: respects namespace session limits', async ({ request }) => {
  // Get current limit info
  const limitsRes = await request.get('/api/namespace/limits');
  const limits = await limitsRes.json() as { maxSessions: number | null };

  if (limits.maxSessions === null) {
    test.skip();
    return;
  }

  // Fill up to the limit
  const sessions = await (await request.get('/api/sessions')).json() as { id: string }[];
  const slotsLeft = limits.maxSessions - sessions.length;

  for (let i = 0; i < slotsLeft; i++) {
    const res = await request.post('/api/session/instant-start');
    expect(res.ok()).toBe(true);
  }

  // Next one should be rejected
  const overLimitRes = await request.post('/api/session/instant-start');
  expect(overLimitRes.status()).toBe(403);
  const body = await overLimitRes.json() as { error: string };
  expect(body.error).toBe('session_limit');
});
