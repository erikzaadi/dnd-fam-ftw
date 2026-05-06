import { expect, test } from '@playwright/test';
import { MOCK_NARRATION_MARKER, openSeedSession, waitForTurnToComplete } from './helpers';

const SESSION_ID = 'seed-session-7';

test('mechanics showcase aligns action bonuses between popup and Chronicle', async ({ page }) => {
  await openSeedSession(page, SESSION_ID);

  await expect(page.getByText('Team Up', { exact: true })).toBeVisible();
  await expect(page.getByText('+2 help (Zara)', { exact: true })).toBeVisible();
  await expect(page.getByText('with Zara', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: /Time the jump while Zara steadies the spell/i }).click();
  await waitForTurnToComplete(page);

  await expect(page.getByText(MOCK_NARRATION_MARKER)).toBeVisible();
  await expect(page.getByText('2 help (Zara)', { exact: true })).toBeVisible();
  await expect(page.getByText('Silver Bridge Token', { exact: true })).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.getByText('tap to dismiss')).not.toBeVisible();

  await page.getByRole('button', { name: /Open Chronicle/i }).click();
  await page.getByRole('button', { name: /Pip's checklist is approved/i }).click();

  await expect(page.getByRole('heading', { name: 'Chronicle' })).toBeVisible();
  await expect(page.getByText('2 help (Zara)', { exact: true })).toBeVisible();
  await expect(page.getByText('Silver Bridge Token', { exact: true })).toBeVisible();
});
