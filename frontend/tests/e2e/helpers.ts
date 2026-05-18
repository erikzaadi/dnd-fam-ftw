import { expect, type APIRequestContext, type Page } from '@playwright/test';

export const MOCK_NARRATION_MARKER = 'The mock DM confirms the adventure moves forward.';

// Suppress first-run overlays before React mounts. Call before page.goto().
export async function suppressFirstRunOverlays(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('tutorial_ever_started', '1');
    localStorage.setItem('dnd-first-run-wizard', JSON.stringify({ completedVersion: 1 }));
  });
}

export async function dismissAudioOverlay(page: Page): Promise<void> {
  const btn = page.getByRole('button', { name: 'Enable Audio' });
  try {
    await btn.waitFor({ state: 'visible', timeout: 2000 });
    await btn.click();
  } catch {
    // overlay not present
  }
}

export async function dismissOriginView(page: Page): Promise<void> {
  const btn = page.getByRole('button', { name: 'Skip' });
  try {
    await btn.waitFor({ state: 'visible', timeout: 2000 });
    await btn.click();
  } catch {
    // origin view not present
  }
}

export async function openSeedSession(page: Page, sessionId: string): Promise<void> {
  await page.goto(`/session/${sessionId}`);
  await dismissAudioOverlay(page);
  await dismissOriginView(page);
  await expect(page.getByText('Choose an Action')).toBeVisible({ timeout: 30_000 });
}

export async function waitForTurnToComplete(page: Page): Promise<void> {
  await expect(page.getByText(MOCK_NARRATION_MARKER)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Choose an Action')).toBeVisible({ timeout: 30_000 });
}

export async function getSessionTurn(request: APIRequestContext, sessionId: string): Promise<number> {
  const response = await request.get(`/api/session/${sessionId}`);
  expect(response.ok()).toBe(true);
  const session = await response.json() as { turn: number };
  return session.turn;
}
