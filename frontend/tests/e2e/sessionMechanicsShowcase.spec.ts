import { expect, test } from '@playwright/test';
import { MOCK_NARRATION_MARKER, openSeedSession, waitForTurnToComplete } from './helpers';

const SESSION_ID = 'seed-session-7';

test('mechanics showcase shows action bonuses and inventory changes in Chronicle', async ({ page }) => {
  await openSeedSession(page, SESSION_ID);

  await expect(page.getByText('Team Up', { exact: true })).toBeVisible();
  // Roll arithmetic is shown by default and can be hidden per viewer.
  await expect(page.getByText('+2 help (Zara)', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Hide the numbers' }).click();
  await expect(page.getByText('+2 help (Zara)', { exact: true })).not.toBeVisible();
  await page.getByRole('button', { name: 'Show the numbers' }).click();
  await expect(page.getByText('+2 help (Zara)', { exact: true })).toBeVisible();
  await expect(page.getByText('with Zara', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: /Time the jump while Zara steadies the spell/i }).click();
  await waitForTurnToComplete(page);

  await expect(page.getByText(MOCK_NARRATION_MARKER)).toBeVisible();

  await page.getByRole('button', { name: /Open Chronicle/i }).click();
  // Each Chronicle card shows its own turn: the team-up just played carries Zara's help
  // bonus and the token it earned.
  await page.getByRole('button', { name: /acts decisively: Time the jump while Zara steadies the spell/i }).click();

  await expect(page.getByRole('heading', { name: 'Chronicle' })).toBeVisible();
  await expect(page.getByText('2 help (Zara)', { exact: true })).toBeVisible();
  await expect(page.getByText('Silver Bridge Token', { exact: true })).toBeVisible();
});
