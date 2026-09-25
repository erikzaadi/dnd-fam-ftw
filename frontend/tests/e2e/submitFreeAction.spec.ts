import { expect, test } from '@playwright/test';
import { MOCK_NARRATION_MARKER, expectMockIdeas, getSessionTurn, openSeedSession, waitForTurnToComplete } from './helpers';

test('submits a custom action and renders the next turn', async ({ page, request }) => {
  const sessionId = 'seed-session-3';
  const action = 'I try to bribe the guard with a shiny coin';
  const beforeTurn = await getSessionTurn(request, sessionId);

  await openSeedSession(page, sessionId);
  // The confirm dialog path: this viewer asks to confirm every action.
  await page.getByRole('button', { name: 'Ask before sending' }).click();
  await page.getByLabel('What do you try?').fill(action);
  await page.getByRole('button', { name: /UNLEASH/i }).click();
  await expect(page.getByText('Confirm your action')).toBeVisible();
  await page.getByRole('button', { name: /^Confirm$/ }).click();
  await waitForTurnToComplete(page);

  await expect(page.getByText(action, { exact: false })).toBeVisible();
  await expect(page.getByText(MOCK_NARRATION_MARKER)).toBeVisible();
  await expectMockIdeas(page);

  const afterTurn = await getSessionTurn(request, sessionId);
  expect(afterTurn).toBe(beforeTurn + 1);
});
