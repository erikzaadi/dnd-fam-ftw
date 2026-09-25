import { expect, test } from '@playwright/test';
import { MOCK_NARRATION_MARKER, expectMockIdeas, getSessionTurn, openSeedSession, waitForTurnToComplete } from './helpers';

test('submits a predefined action and renders the next turn', async ({ page, request }) => {
  const sessionId = 'seed-session-1';
  const beforeTurn = await getSessionTurn(request, sessionId);

  await openSeedSession(page, sessionId);
  await page.getByRole('button', { name: /Strike with your weapon/i }).click();
  await waitForTurnToComplete(page);

  await expect(page.getByText(MOCK_NARRATION_MARKER)).toBeVisible();
  await expectMockIdeas(page);

  const afterTurn = await getSessionTurn(request, sessionId);
  expect(afterTurn).toBe(beforeTurn + 1);
});
