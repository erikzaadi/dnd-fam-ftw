import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SESSIONS,
  dismissAudioOverlay,
  waitForSessionReady,
  getSessionOrFail,
  enableSavingsMode,
  suppressFirstRunOverlays,
  suppressSetupTutorials,
  freezeAnimations,
  setupCarModeRoutes,
} from './helpers';

// Generates the screenshots referenced by README.md into docs/.
// Run with: npm run generate-readme-screenshots (from the repo root).
// Servers and a seeded throwaway database are managed by playwright.readme.config.ts.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOCS_DIR = path.resolve(__dirname, '../../docs');

const DESKTOP = { width: 1280, height: 900 };
const MOBILE_PORTRAIT = { width: 390, height: 844 };
const MOBILE_LANDSCAPE = { width: 844, height: 390 };

async function shoot(page: Page, name: string): Promise<void> {
  await freezeAnimations(page);
  // Let images and fonts settle; SSE keeps the network busy so networkidle never fires.
  await page.waitForTimeout(750);
  await page.screenshot({ path: path.join(DOCS_DIR, `${name}.png`) });
}

async function prepare(page: Page): Promise<void> {
  await suppressFirstRunOverlays(page);
  await suppressSetupTutorials(page);
}

test('home', async ({ page, request }) => {
  await prepare(page);
  const session = await getSessionOrFail(request, SESSIONS.standard);
  await page.setViewportSize(DESKTOP);
  await page.goto('/');
  await dismissAudioOverlay(page);
  await expect(page.getByText(session.displayName).first()).toBeVisible();
  await shoot(page, 'home');
});

test('create-world', async ({ page }) => {
  await prepare(page);
  await page.setViewportSize(DESKTOP);
  await page.goto('/create-session');
  await dismissAudioOverlay(page);
  await expect(page.getByText('New Journey')).toBeVisible();
  await expect(page.getByRole('button', { name: 'ZUG-MA-GEDDON' })).toBeVisible();
  await shoot(page, 'create-world');
});

test('assemble-party and create-hero-form', async ({ page, request }) => {
  await prepare(page);
  const session = await getSessionOrFail(request, SESSIONS.standard);
  await page.setViewportSize(DESKTOP);
  await page.goto(`/session/${session.id}/assembly`);
  await dismissAudioOverlay(page);
  await expect(page.getByRole('heading', { name: 'Assemble Your Party' })).toBeVisible();
  await expect(page.getByText('Current Heroes')).toBeVisible();
  await shoot(page, 'assemble-party');

  await page.getByRole('button', { name: '+ Add Another Hero' }).click();
  await expect(page.getByRole('heading', { name: 'Create New Hero' })).toBeVisible();
  // Apply a quick hero preset so class, species, quirk, and stats are filled in
  await page.locator('[data-tutorial="preset-chooser"] button').first().click();
  await page.fill('input[name="name"]', 'Mira Toadwhisper');
  await shoot(page, 'create-hero-form');
});

test('recap-mode-select', async ({ page, request }) => {
  await prepare(page);
  const session = await getSessionOrFail(request, SESSIONS.standard);
  await enableSavingsMode(request, session.id);
  await page.setViewportSize(DESKTOP);
  await page.goto(`/session/${session.id}/recap`);
  await dismissAudioOverlay(page);
  await expect(page.getByText('How would you like to catch up?')).toBeVisible();
  await shoot(page, 'recap-mode-select');
});

test('inventory-panel', async ({ page, request }) => {
  await prepare(page);
  const session = await getSessionOrFail(request, SESSIONS.inventory);
  await enableSavingsMode(request, session.id);
  await page.setViewportSize(DESKTOP);
  await page.goto(`/session/${session.id}`);
  await dismissAudioOverlay(page);
  await waitForSessionReady(page);
  await page.getByRole('button', { name: 'Show party gear' }).click();
  await expect(page.getByRole('heading', { name: /Treasure & Gear/i })).toBeVisible();
  await shoot(page, 'inventory-panel');
});

test('character-popup', async ({ page, request }) => {
  await prepare(page);
  const session = await getSessionOrFail(request, SESSIONS.characterPopup);
  await enableSavingsMode(request, session.id);
  await page.setViewportSize(DESKTOP);
  await page.goto(`/session/${session.id}`);
  await dismissAudioOverlay(page);
  await waitForSessionReady(page);
  await page.getByAltText('Pipwick').first().click();
  const popup = page.locator('div.bg-slate-900').filter({ has: page.getByRole('heading', { name: 'Pipwick' }) }).first();
  await expect(popup.getByRole('heading', { name: 'Pipwick' })).toBeVisible();
  // Expand the stat breakdown so the shot shows base + gear bonuses
  await popup.locator('button').filter({ hasText: 'Mischief' }).click();
  await expect(popup.getByText('4 base')).toBeVisible();
  await shoot(page, 'character-popup');
});

test('terminal-mode', async ({ page, request }) => {
  await prepare(page);
  const session = await getSessionOrFail(request, SESSIONS.standard);
  await enableSavingsMode(request, session.id);
  await page.setViewportSize(DESKTOP);
  await page.goto(`/session/${session.id}/terminal`);
  await dismissAudioOverlay(page);
  await expect(page.getByText('Adventure Shell Ready', { exact: false })).toBeVisible({ timeout: 10_000 });
  await shoot(page, 'terminal-mode');
});

test('story-scene (mobile)', async ({ page, request }) => {
  await prepare(page);
  const session = await getSessionOrFail(request, SESSIONS.dragonPeak);
  await enableSavingsMode(request, session.id);
  await page.setViewportSize(MOBILE_PORTRAIT);
  await page.goto(`/session/${session.id}`);
  await dismissAudioOverlay(page);
  await waitForSessionReady(page);
  await shoot(page, 'story-scene');
});

test('action-choices (mobile)', async ({ page, request }) => {
  await prepare(page);
  const session = await getSessionOrFail(request, SESSIONS.mechanicsShowcase);
  await enableSavingsMode(request, session.id);
  await page.setViewportSize(MOBILE_PORTRAIT);
  await page.goto(`/session/${session.id}`);
  await dismissAudioOverlay(page);
  await waitForSessionReady(page);
  await page.getByRole('button', { name: 'Actions' }).click();
  // On mobile the action dock also renders behind the overlay, so scope to the overlay
  const actionsOverlay = page.locator('div.fixed.inset-0').filter({ hasText: 'Hide actions' });
  await expect(actionsOverlay.getByText('Team Up', { exact: true })).toBeVisible();
  await expect(actionsOverlay.getByText('+2 help (Zara)', { exact: true })).toBeVisible();
  await shoot(page, 'action-choices');
});

test('car-mode (mobile landscape)', async ({ page }) => {
  const sessionId = 'readme-car-mode';
  await prepare(page);
  await page.addInitScript(() => {
    localStorage.setItem('dnd-tts-settings', JSON.stringify({ enabled: true }));
    localStorage.setItem('dnd-stt-settings', JSON.stringify({ enabled: true }));
  });
  await setupCarModeRoutes(page, sessionId);
  await page.setViewportSize(MOBILE_LANDSCAPE);
  await page.goto(`/session/${sessionId}/car`);
  await dismissAudioOverlay(page);
  await expect(page.getByText('Car Mode Adventure')).toBeVisible({ timeout: 5_000 });
  await shoot(page, 'car-mode');
});
