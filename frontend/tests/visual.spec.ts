import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

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

async function getSessionOrSkip(request: APIRequestContext, id: string): Promise<SessionListItem | null> {
  const res = await request.get('/api/sessions');
  const sessions = await res.json() as SessionListItem[];
  const session = sessions.find(s => s.id === id);
  if (!session) {
    test.skip(true, `Seed session ${id} was not found`);
    return null;
  }
  return session;
}

async function enableSavingsMode(request: APIRequestContext, sessionId: string): Promise<void> {
  const res = await request.post(`/api/session/${sessionId}/savings-mode`, {
    data: { enabled: true },
  });
  expect(res.ok()).toBe(true);
}

test('home', async ({ page }) => {
  await page.goto('/');
  await dismissAudioOverlay(page);
  await screenshotViewports(page, 'home');
});

test('settings', async ({ page }) => {
  await page.goto('/settings');
  await dismissAudioOverlay(page);
  // Wait for settings to load from API before screenshotting
  await page.waitForSelector('h2', { state: 'visible' });
  await screenshotViewports(page, 'settings');
});

test('session banner hidden', async ({ page, request }) => {
  test.setTimeout(60_000);
  const session = await getSessionOrSkip(request, SESSIONS.standard);
  if (!session) {
    return;
  }
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
  const session = await getSessionOrSkip(request, SESSIONS.standard);
  if (!session) {
    return;
  }
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
  const session = await getSessionOrSkip(request, SESSIONS.chronicle);
  if (!session) {
    return;
  }
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

  const chronicleLink = page.getByRole('button', { name: /Open Chronicle/i });
  await chronicleLink.scrollIntoViewIfNeeded();
  await expect(chronicleLink).toBeVisible();
  await chronicleLink.click();

  await expect(page.getByRole('heading', { name: 'Chronicle' })).toBeVisible();
  await expect(page.getByText('Choose an Action')).not.toBeVisible();

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
  const session = await getSessionOrSkip(request, SESSIONS.inventory);
  if (!session) {
    return;
  }
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
  const session = await getSessionOrSkip(request, CHARACTER_POPUP_TARGET.sessionId);
  if (!session) {
    return;
  }
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

test('seeded sessions', async ({ page, request }) => {
  test.setTimeout(120_000);
  const picks = [
    { id: SESSIONS.fallen, slug: 'the-tomb-of-endless-dark' },
    { id: SESSIONS.dragonPeak, slug: 'dragon-peak' },
    { id: SESSIONS.storyRealm, slug: 'whispering-shadows-realm' },
  ];

  for (const pick of picks) {
    const session = await getSessionOrSkip(request, pick.id);
    if (!session) {
      continue;
    }
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
