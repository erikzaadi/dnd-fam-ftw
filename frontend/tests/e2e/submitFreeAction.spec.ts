import { expect, test } from '@playwright/test';
import { MOCK_NARRATION_MARKER, getSessionTurn, openSeedSession, waitForTurnToComplete } from './helpers';

test('submits a custom action and renders the next turn', async ({ page, request }) => {
  const sessionId = 'seed-session-3';
  const action = 'I try to bribe the guard with a shiny coin';
  const beforeTurn = await getSessionTurn(request, sessionId);

  await openSeedSession(page, sessionId);
  await page.getByPlaceholder('Describe a different action...').fill(action);
  await page.getByRole('button', { name: /UNLEASH/i }).click();
  await waitForTurnToComplete(page);

  await expect(page.getByText(action, { exact: false })).toBeVisible();
  await expect(page.getByText(MOCK_NARRATION_MARKER)).toBeVisible();
  await expect(page.getByRole('button', { name: /Press the attack/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Taunt the goblin/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Flee dramatically/i })).toBeVisible();

  const afterTurn = await getSessionTurn(request, sessionId);
  expect(afterTurn).toBe(beforeTurn + 1);
});
