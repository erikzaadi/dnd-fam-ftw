import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = path.resolve(__dirname, '../../backend');

const VIEWPORTS = [
  { width: 390, height: 844, name: 'mobile-portrait' },
  { width: 844, height: 390, name: 'mobile-landscape' },
  { width: 768, height: 1024, name: 'tablet-portrait' },
  { width: 1024, height: 768, name: 'tablet-landscape' },
  { width: 1280, height: 900, name: 'desktop' },
  { width: 1920, height: 1080, name: 'desktop-1080p' },
  { width: 2560, height: 1440, name: 'desktop-ultrawide' },
  { width: 3440, height: 1440, name: 'desktop-ultrawide-21-9' },
];

const SESSIONS = {
  standard: 'seed-session-1',
  dragonPeak: 'seed-session-2',
  inventory: 'seed-session-1',
  characterPopup: 'seed-session-3',
  chronicle: 'seed-session-1',
  fallen: 'seed-session-6',
  storyRealm: 'seed-session-5',
  mechanicsShowcase: 'seed-session-7',
} as const;

const SEEDED_PARTY = {
  [SESSIONS.standard]: ['Barnabas Strongarm', 'Zara the Nimble', 'Eldwin Spark', 'Mira the Bold'],
  [SESSIONS.characterPopup]: ['Pipwick', 'Thalia Stone', 'Brother Oswin', 'Mirela Voss'],
} as const;

const SEEDED_INVENTORY = {
  [SESSIONS.inventory]: ['🧪 Healing Potion', '🔮 Arcane Focus', '🪓 Battle Axe +1'],
} as const;

const CHARACTER_POPUP_TARGET = {
  sessionId: SESSIONS.characterPopup,
  characterName: 'Pipwick',
} as const;

type SessionListItem = { id: string; displayName: string; gameOver?: boolean };

async function dismissAudioOverlay(page: Page): Promise<void> {
  const btn = page.getByRole('button', { name: 'Enable Audio' });
  try {
    await btn.waitFor({ state: 'visible', timeout: 2000 });
    await btn.click();
  } catch {
    // overlay not present
  }
}

async function waitForSessionReady(page: Page): Promise<void> {
  // Session screenshots should not capture transient image-generation state.
  try {
    await page.getByText('Painting the scene...').waitFor({ state: 'hidden', timeout: 30_000 });
  } catch {
    // not present or already gone
  }
}

async function screenshotViewports(page: Page, slug: string): Promise<void> {
  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await expect(page).toHaveScreenshot(`${slug}-${vp.name}.png`, {
      fullPage: true,
      animations: 'disabled',
      maxDiffPixelRatio: 0.01,
    });
  }
}

async function getSessionOrFail(request: APIRequestContext, id: string): Promise<SessionListItem> {
  const res = await request.get('/api/sessions');
  expect(res.ok()).toBe(true);
  const sessions = await res.json() as SessionListItem[];
  const session = sessions.find(s => s.id === id);
  expect(
    session,
    `Seed session ${id} was not found. Run "cd backend && npm run cli -- sessions seed" against the visual-test database before updating snapshots.`
  ).toBeTruthy();
  return session;
}

async function setSavingsMode(request: APIRequestContext, sessionId: string, enabled: boolean): Promise<void> {
  const res = await request.post(`/api/session/${sessionId}/savings-mode`, {
    data: { enabled },
  });
  expect(res.ok()).toBe(true);
}

async function enableSavingsMode(request: APIRequestContext, sessionId: string): Promise<void> {
  await setSavingsMode(request, sessionId, true);
}

// Suppress the onboarding tutorial in all visual tests. Each test calls this
// before page.goto() so the initScript fires before React mounts.
async function suppressTutorial(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('tutorial_ever_started', '1');
  });
}

function seedSessionsFixture(): void {
  execFileSync('npm', ['run', 'cli', '--', 'sessions', 'seed'], {
    cwd: BACKEND_DIR,
    env: process.env,
    stdio: 'pipe',
  });
}

test('home', async ({ page }) => {
  await suppressTutorial(page);
  // Stub sessions so the snapshot is stable regardless of database state
  await page.route('**/api/sessions', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify([]),
  }));
  await page.goto('/');
  await dismissAudioOverlay(page);
  await screenshotViewports(page, 'home');
});

test('home returning user', async ({ page }) => {
  const sessionId = 'visual-returning-user';
  // Set both keys before React mounts so the returning-user layout renders immediately
  await page.addInitScript((id: string) => {
    localStorage.setItem('tutorial_ever_started', '1');
    localStorage.setItem('onboarding_session_id', id);
  }, sessionId);
  await page.route('**/api/sessions', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify([{
      id: sessionId,
      displayName: 'The Ember Wastes',
      difficulty: 'normal',
      gameMode: 'classic',
      party: [],
    }]),
  }));
  await page.goto('/');
  await dismissAudioOverlay(page);
  await screenshotViewports(page, 'home-returning-user');
});

test('instant-start-loader', async ({ page }) => {
  await suppressTutorial(page);
  // Intercept the instant-start POST to return a fake pending session ID
  // without triggering real background work. This keeps the loader visible
  // indefinitely so we can snapshot it in a stable state.
  await page.route('**/api/session/instant-start', route => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 'visual-test-pending', savingsMode: false }),
    });
  });
  // Prevent the SSE stream from ever sending a readiness event for this fake ID
  await page.route('**/api/sessions/events', route => route.abort());

  await page.goto('/');
  await dismissAudioOverlay(page);
  await page.getByRole('button', { name: /Quick Start/i }).click();

  // Wait for the loader to mount before freezing the pun text
  await expect(page.getByTestId('instant-start-loader')).toBeVisible({ timeout: 5_000 });

  // Freeze the pun cycle at a stable value for the snapshot
  await page.evaluate(() => {
    const el = document.querySelector('[data-testid="instant-start-pun"]') ??
      Array.from(document.querySelectorAll('p')).find(p => p.textContent?.includes('...'));
    if (el) {
      el.textContent = 'Consulting the ancient dice...';
    }
  });

  await screenshotViewports(page, 'instant-start-loader');
});

test('settings', async ({ page }) => {
  await suppressTutorial(page);
  await page.goto('/settings');
  await dismissAudioOverlay(page);
  // Wait for settings to load from API before screenshotting
  await page.waitForSelector('h2', { state: 'visible' });
  await screenshotViewports(page, 'settings');
});

test('get-me-rollin', async ({ page }) => {
  await suppressTutorial(page);
  await page.goto('/get-me-rollin');
  await dismissAudioOverlay(page);
  // Wait for stat icons to load before screenshotting
  await page.waitForSelector('img[src*="icon_might"]', { state: 'visible' });
  await screenshotViewports(page, 'get-me-rollin');
});

test('session banner hidden', async ({ page, request }) => {
  test.setTimeout(60_000);
  await suppressTutorial(page);
  const session = await getSessionOrFail(request, SESSIONS.standard);
  await enableSavingsMode(request, session.id);
  await page.goto(`/session/${session.id}`);
  await dismissAudioOverlay(page);
  await waitForSessionReady(page);
  await page.getByRole('button', { name: 'Hide banner' }).click();
  await expect(page.getByRole('button', { name: 'Show banner' })).toBeVisible();
  await expect(page.getByText(session.displayName)).not.toBeVisible();
  await screenshotViewports(page, 'session-banner-hidden');
});

test('session narration fullscreen', async ({ page, request }) => {
  test.setTimeout(60_000);
  await suppressTutorial(page);
  const session = await getSessionOrFail(request, SESSIONS.standard);
  await enableSavingsMode(request, session.id);

  const historyRes = await request.get(`/api/session/${session.id}/history`);
  const history = await historyRes.json() as { narration: string }[];
  if (history.length === 0) {
    test.skip();
    return;
  }

  await page.goto(`/session/${session.id}`);
  await dismissAudioOverlay(page);
  await waitForSessionReady(page);
  await page.getByRole('button', { name: 'Hide banner' }).click();

  // Click the narration card to open the fullscreen popup
  const narrationCard = page.locator('p.italic.text-center').first();
  await narrationCard.waitFor({ state: 'visible' });
  await narrationCard.click();

  // Verify the fullscreen overlay is shown (fixed full-screen container with bg-slate-950)
  const firstNarration = history[history.length - 1].narration;
  const fullscreenOverlay = page.locator('div.fixed.inset-0.bg-slate-950');
  await expect(fullscreenOverlay).toBeVisible();
  await expect(fullscreenOverlay.getByText(firstNarration.slice(0, 60), { exact: false })).toBeVisible();
  await screenshotViewports(page, 'session-narration-fullscreen-open');

  // Dismiss by pressing Escape
  await page.keyboard.press('Escape');
  await expect(page.locator('p.italic.text-center').first()).toBeVisible();
  await expect(fullscreenOverlay).not.toBeVisible();
  await screenshotViewports(page, 'session-narration-fullscreen-closed');
});

test('session chronicle open and second turn', async ({ page, request }) => {
  test.setTimeout(60_000);
  await suppressTutorial(page);
  const session = await getSessionOrFail(request, SESSIONS.chronicle);
  await enableSavingsMode(request, session.id);

  const historyRes = await request.get(`/api/session/${session.id}/history`);
  const history = await historyRes.json() as { narration: string }[];

  if (history.length < 2) {
    test.skip();
    return;
  }

  // Chronicle shows newest first, so second item = history[length - 2]
  const secondTurnNarration = history[history.length - 2].narration;

  await page.goto(`/session/${session.id}`);
  await dismissAudioOverlay(page);
  await waitForSessionReady(page);

  // Verify party count and names via avatar alt text in the HUD
  for (const name of SEEDED_PARTY[SESSIONS.chronicle]) {
    await expect(page.getByAltText(name).first()).toBeVisible();
  }

  await page.keyboard.press('c');

  await expect(page.getByRole('heading', { name: 'Chronicle' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close chronicle' })).toBeVisible();

  // Turn buttons contain an italic narration snippet paragraph
  const turnButtons = page.locator('button').filter({ has: page.locator('p.italic') });
  await expect(turnButtons).toHaveCount(history.length);

  await turnButtons.nth(1).scrollIntoViewIfNeeded();
  await turnButtons.nth(1).click();

  // Expanded turn should show the narration text (first() because it also appears in the narration card)
  await expect(page.getByText(secondTurnNarration.slice(0, 60), { exact: false }).first()).toBeVisible();

  await screenshotViewports(page, 'session-chronicle-second-turn');
});

test('session inventory panel', async ({ page, request }) => {
  test.setTimeout(60_000);
  await suppressTutorial(page);
  const session = await getSessionOrFail(request, SESSIONS.inventory);
  await enableSavingsMode(request, session.id);
  const inventoryItems = SEEDED_INVENTORY[SESSIONS.inventory];
  const partyMembers = SEEDED_PARTY[SESSIONS.inventory];
  if (inventoryItems.length === 0) {
    test.skip(true, `Seed session ${session.id} has no inventory items`);
    return;
  }

  await page.goto(`/session/${session.id}`);
  await dismissAudioOverlay(page);
  await waitForSessionReady(page);

  // Verify party count and names via avatar alt text in the HUD
  for (const name of partyMembers) {
    await expect(page.getByAltText(name).first()).toBeVisible();
  }

  await page.getByRole('button', { name: 'Show party gear' }).click();
  await expect(page.getByRole('heading', { name: /Treasure & Gear/i })).toBeVisible();

  for (const itemName of inventoryItems) {
    await expect(page.getByText(itemName)).toBeVisible();
  }
  await expect(page.getByText(/0\s*·transferable/i)).not.toBeVisible();

  await screenshotViewports(page, 'session-inventory');
});

test('session character popup', async ({ page, request }) => {
  test.setTimeout(60_000);
  await suppressTutorial(page);
  const session = await getSessionOrFail(request, CHARACTER_POPUP_TARGET.sessionId);
  await enableSavingsMode(request, session.id);

  await page.goto(`/session/${session.id}`);
  await dismissAudioOverlay(page);
  await waitForSessionReady(page);

  await page.getByAltText(CHARACTER_POPUP_TARGET.characterName).first().click();
  const popup = page.locator('div.bg-slate-900').filter({ has: page.getByRole('heading', { name: CHARACTER_POPUP_TARGET.characterName }) }).first();
  await expect(popup.getByRole('heading', { name: CHARACTER_POPUP_TARGET.characterName })).toBeVisible();
  await expect(popup.getByText('Gnome · Bard')).toBeVisible();
  await expect(popup.getByText('"Turns every conversation into a song"')).toBeVisible();
  await expect(popup.getByText('7 / 10')).toBeVisible();
  await expect(popup.getByText('Lute of Distraction')).toBeVisible();
  await expect(popup.getByText(/0\s*·transferable/i)).not.toBeVisible();

  await expect(popup.locator('button').filter({ hasText: 'Mischief' })).toContainText('5');
  await expect(popup.locator('button').filter({ hasText: 'Might' })).toContainText('1');
  await expect(popup.locator('button').filter({ hasText: 'Magic' })).toContainText('2');

  await popup.locator('button').filter({ hasText: 'Mischief' }).click();
  await expect(popup.getByText('4 base')).toBeVisible();
  await expect(popup.getByText(/\+1 .*Lute of Distraction/)).toBeVisible();

  await screenshotViewports(page, 'session-character-popup');
});

test('session mechanics showcase visual asserts', async ({ page, request }) => {
  test.setTimeout(120_000);
  await suppressTutorial(page);
  seedSessionsFixture();
  const session = await getSessionOrFail(request, SESSIONS.mechanicsShowcase);
  await enableSavingsMode(request, session.id);

  const historyRes = await request.get(`/api/session/${session.id}/history`);
  const history = await historyRes.json() as { narration: string }[];
  const shortNarration = history[history.length - 1]?.narration ?? '';
  const longNarration = history.find(turn => turn.narration.includes('Clockwork Bridge unfolds'))?.narration ?? '';

  await page.goto(`/session/${session.id}`);
  await dismissAudioOverlay(page);
  await waitForSessionReady(page);

  for (const label of ['Team Up', 'Gear', 'Social', 'Obstacle']) {
    await expect(page.getByText(label, { exact: true })).toBeVisible();
  }
  for (const bonus of ['+2 help (Zara)', '+2 gear (🪢 Anchor)', '+2 social']) {
    await expect(page.getByText(bonus, { exact: true })).toBeVisible();
  }
  for (const pill of ['with Zara', '🪢 Anchor Rope', 'swinging counterweights']) {
    await expect(page.getByText(pill, { exact: true })).toBeVisible();
  }

  for (const viewport of [{ width: 844, height: 390 }, { width: 1280, height: 900 }]) {
    await page.setViewportSize(viewport);
    const actionSurface = viewport.width < 1024 ? page.locator('div.fixed.inset-0').filter({ hasText: 'Hide actions' }) : page;
    if (viewport.width < 1024) {
      await page.getByRole('button', { name: 'Actions' }).click();
    }
    await expect(actionSurface.getByPlaceholder('Describe a different action...')).toBeVisible();
    await expect(actionSurface.getByRole('button', { name: 'UNLEASH' })).toBeVisible();
    if (viewport.width < 1024) {
      await page.getByRole('button', { name: 'Hide actions' }).click();
    }
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByText(shortNarration, { exact: true })).toBeVisible();
  const narrationText = page.getByLabel('Story narration').locator('p');
  await expect.poll(async () => {
    return narrationText.evaluate(el => el.scrollHeight <= el.clientHeight + 4);
  }).toBe(true);
  await screenshotViewports(page, 'session-mechanics-showcase-short-narration');

  await page.keyboard.press('c');
  await page.getByRole('button', { name: new RegExp(longNarration.slice(0, 40)) }).click();
  await expect(narrationText).toHaveText(longNarration);
  await expect.poll(async () => {
    return narrationText.evaluate(el => el.scrollHeight > el.clientHeight + 4);
  }).toBe(true);
  await screenshotViewports(page, 'session-mechanics-showcase-long-narration');
});

test('seeded sessions', async ({ page, request }) => {
  test.setTimeout(120_000);
  await suppressTutorial(page);
  const picks = [
    { id: SESSIONS.fallen, slug: 'the-tomb-of-endless-dark' },
    { id: SESSIONS.dragonPeak, slug: 'dragon-peak' },
    { id: SESSIONS.storyRealm, slug: 'whispering-shadows-realm' },
  ];

  for (const pick of picks) {
    const session = await getSessionOrFail(request, pick.id);
    await enableSavingsMode(request, session.id);
    const historyRes = await request.get(`/api/session/${session.id}/history`);
    const history = await historyRes.json() as { narration: string }[];
    const lastNarration = history[history.length - 1]?.narration ?? null;

    await page.goto(`/session/${session.id}`);
    await dismissAudioOverlay(page);
    await waitForSessionReady(page);

    // Game-over sessions show a "Campaign Over" screen without the narration text
    if (session.gameOver) {
      await expect(page.getByText('Campaign Over')).toBeVisible();
      await expect(page.getByRole('button', { name: /View Chronicle/i })).toBeVisible();
    } else if (lastNarration) {
      await expect(page.getByText(lastNarration.slice(0, 60), { exact: false }).first()).toBeVisible({ timeout: 15_000 });
    }

    await screenshotViewports(page, `session-${pick.slug}`);
  }
});
