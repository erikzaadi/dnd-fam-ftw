import { expect, test } from '@playwright/test';
import { MOCK_NARRATION_MARKER, getSessionTurn, openSeedSession, waitForTurnToComplete } from './helpers';

test('submits a predefined action and renders the next turn', async ({ page, request }) => {
  const sessionId = 'seed-session-1';
  const beforeTurn = await getSessionTurn(request, sessionId);

  await openSeedSession(page, sessionId);
  await page.getByRole('button', { name: /Strike with your weapon/i }).click();
  await waitForTurnToComplete(page);

  await expect(page.getByText(MOCK_NARRATION_MARKER)).toBeVisible();
  await expect(page.getByRole('button', { name: /Press the attack/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Taunt the goblin/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Flee dramatically/i })).toBeVisible();

  const afterTurn = await getSessionTurn(request, sessionId);
  expect(afterTurn).toBe(beforeTurn + 1);
});
