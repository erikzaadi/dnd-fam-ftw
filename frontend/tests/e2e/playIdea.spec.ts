import { expect, test } from '@playwright/test';
import { MOCK_NARRATION_MARKER, expectMockIdeas, getSessionTurn, openSeedSession, waitForTurnToComplete } from './helpers';

// A typed action (sent with one tap), then an idea for the next turn, requested with
// "Give me ideas" and played by id.
test('plays a suggestion after a typed action', async ({ page, request }) => {
  const sessionId = 'seed-session-5';
  const beforeTurn = await getSessionTurn(request, sessionId);

  await openSeedSession(page, sessionId);
  // One-tap path: a clean typed action is sent after the Undo window, no dialog.
  await page.getByLabel('What do you try?').fill('I listen at the door for voices');
  await page.getByRole('button', { name: /UNLEASH/i }).click();
  await expect(page.getByText('Sending:')).toBeVisible();
  await expect(page.getByText('Confirm your action')).toHaveCount(0);
  await waitForTurnToComplete(page);

  await expectMockIdeas(page);
  await page.getByRole('button', { name: /Taunt the goblin/i }).click();
  await expect(page.getByText('Taunt the goblin', { exact: false }).first()).toBeVisible();
  await expect(page.getByText(MOCK_NARRATION_MARKER).first()).toBeVisible({ timeout: 30_000 });

  await expect.poll(() => getSessionTurn(request, sessionId), { timeout: 30_000 }).toBe(beforeTurn + 2);
});
