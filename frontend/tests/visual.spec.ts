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
type VisualCharacter = { id: string; name: string; status?: string };
type SessionDetail = {
  id: string;
  activeCharacterId?: string;
  party: VisualCharacter[];
};

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

async function getSessionDetailOrFail(request: APIRequestContext, id: string): Promise<SessionDetail> {
  const res = await request.get(`/api/session/${id}`);
  expect(res.ok()).toBe(true);
  return await res.json() as SessionDetail;
}

async function mockPreviewAction(page: Page): Promise<void> {
  await page.route('**/api/session/*/preview-action', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      originalAction: 'Improve this gear for the current problem.',
      interpretedAction: 'Barnabas tunes the arcane focus so it hums in rhythm with the shifting path.',
      stat: 'magic',
      difficulty: 'normal',
      difficultyValue: 12,
      warnings: [],
      narration: 'The focus glows softly, turning a risky idea into a clear next move.',
      choiceItemBonus: 2,
      choiceItemName: '🔮 Arcane Focus',
      choiceItemOwnerName: 'Barnabas Strongarm',
      flavor: 'item',
    }),
  }));
}

// Suppress first-run overlays in visual tests. Each test calls this
// before page.goto() so the initScript fires before React mounts.
async function suppressFirstRunOverlays(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('tutorial_ever_started', '1');
    localStorage.setItem('dnd-first-run-wizard', JSON.stringify({ completedVersion: 1 }));
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
  await suppressFirstRunOverlays(page);
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

test('first-run-wizard', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('tutorial_ever_started', '1');
  });
  await page.route('**/api/sessions', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify([]),
  }));
  await page.route('**/api/settings', route => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ imagesEnabled: true }),
      });
    }
    return route.continue();
  });
  await page.route('**/api/capabilities', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ hasCloudAI: true, hasTts: true }),
  }));
  await page.goto('/');
  await expect(page.getByText('First Setup')).toBeVisible();
  await expect(page.getByText('How should the story look?')).toBeVisible();
  await screenshotViewports(page, 'first-run-wizard');
});

test('home returning user', async ({ page }) => {
  const sessionId = 'visual-returning-user';
  // Set both keys before React mounts so the returning-user layout renders immediately
  await page.addInitScript((id: string) => {
    localStorage.setItem('tutorial_ever_started', '1');
    localStorage.setItem('dnd-first-run-wizard', JSON.stringify({ completedVersion: 1 }));
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
  await suppressFirstRunOverlays(page);
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
  await suppressFirstRunOverlays(page);
  await page.goto('/settings');
  await dismissAudioOverlay(page);
  // Wait for settings to load from API before screenshotting
  await page.waitForSelector('h2', { state: 'visible' });
  await screenshotViewports(page, 'settings');
});

test('get-me-rollin', async ({ page }) => {
  await suppressFirstRunOverlays(page);
  await page.goto('/get-me-rollin');
  await dismissAudioOverlay(page);
  // Wait for stat icons to load before screenshotting
  await page.waitForSelector('img[src*="icon_might"]', { state: 'visible' });
  await screenshotViewports(page, 'get-me-rollin');
});

test('session banner hidden', async ({ page, request }) => {
  test.setTimeout(60_000);
  await suppressFirstRunOverlays(page);
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
  await suppressFirstRunOverlays(page);
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
  await suppressFirstRunOverlays(page);
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
  await suppressFirstRunOverlays(page);
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

test('session inventory gear helper preview', async ({ page, request }) => {
  test.setTimeout(60_000);
  await suppressFirstRunOverlays(page);
  await mockPreviewAction(page);
  const session = await getSessionOrFail(request, SESSIONS.inventory);
  await enableSavingsMode(request, session.id);

  await page.goto(`/session/${session.id}`);
  await dismissAudioOverlay(page);
  await waitForSessionReady(page);

  await expect(page.getByRole('button', { name: 'Preview party boost' })).toBeVisible();
  await page.getByRole('button', { name: 'Show party gear' }).click();
  await expect(page.getByRole('heading', { name: /Treasure & Gear/i })).toBeVisible();

  const improveGearButton = page.getByRole('button', { name: /Enchant|Craft|Tinker/ }).first();
  await expect(improveGearButton).toBeVisible();
  await improveGearButton.click();

  await expect(page.getByText('Confirm your action')).toBeVisible();
  await expect(page.getByText('Barnabas tunes the arcane focus')).toBeVisible();
  await expect(page.getByText('+2 gear (🔮 Arcane)')).toBeVisible();

  await screenshotViewports(page, 'session-inventory-gear-helper-preview');
});

test('session character popup', async ({ page, request }) => {
  test.setTimeout(60_000);
  await suppressFirstRunOverlays(page);
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

test('session character support popup', async ({ page, request }) => {
  test.setTimeout(60_000);
  await suppressFirstRunOverlays(page);
  const session = await getSessionOrFail(request, CHARACTER_POPUP_TARGET.sessionId);
  await enableSavingsMode(request, session.id);
  const detail = await getSessionDetailOrFail(request, session.id);
  const target = detail.party.find(c =>
    c.id !== detail.activeCharacterId &&
    c.status !== 'downed'
  );
  if (!target) {
    test.skip(true, `Seed session ${session.id} has no active ally target`);
    return;
  }

  await page.goto(`/session/${session.id}`);
  await dismissAudioOverlay(page);
  await waitForSessionReady(page);

  await page.getByAltText(target.name).first().click();
  const popup = page.getByRole('dialog', { name: `${target.name} character details` });
  await expect(popup).toBeVisible();
  await expect(popup.getByRole('button', { name: 'Bless' })).toBeVisible();
  await expect(popup.getByRole('button', { name: 'Aid' })).toBeVisible();

  await screenshotViewports(page, 'session-character-support-popup');
});

test('session mechanics showcase visual asserts', async ({ page, request }) => {
  test.setTimeout(120_000);
  await suppressFirstRunOverlays(page);
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
  for (const bonus of ['+2 help (Zara)', '+2 social']) {
    await expect(page.getByText(bonus, { exact: true })).toBeVisible();
  }
  await expect(page.getByText('+2 gear (🪢 Anchor)', { exact: true })).not.toBeVisible();
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
  await suppressFirstRunOverlays(page);
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

test('session encounter panel - all HP label states', async ({ page }) => {
  const sessionId = 'visual-encounter-panel';
  await suppressFirstRunOverlays(page);

  const fakeSession = {
    id: sessionId,
    scene: 'Goblin Chief',
    sceneId: 'goblin-cave',
    turn: 5,
    displayName: 'The Goblin Caves',
    savingsMode: true,
    gameMode: 'balanced',
    difficulty: 'normal',
    tone: 'thrilling',
    storySummary: '',
    npcs: [],
    quests: [],
    recentHistory: ['The battle rages on inside the goblin caves.'],
    lastChoices: [
      { label: 'Strike the chief', difficulty: 'normal', stat: 'might', flavor: 'standard' },
      { label: 'Use the shadows', difficulty: 'normal', stat: 'mischief', flavor: 'standard' },
    ],
    activeCharacterId: 'char-1',
    party: [{
      id: 'char-1',
      name: 'Barnabas',
      class: 'Fighter',
      species: 'Human',
      quirk: 'Never backs down',
      hp: 8,
      max_hp: 10,
      status: 'active',
      stats: { might: 4, magic: 1, mischief: 2 },
      inventory: [],
    }],
    interventionState: { rescuesUsed: 0 },
    encounterState: {
      id: 'enc-goblin',
      name: 'Goblin Cave Brawl',
      status: 'active',
      round: 2,
      objective: 'Drive back the goblin horde',
      enemies: [
        {
          id: 'e-fresh',
          name: 'Goblin Chief',
          role: 'boss',
          hp: 19,
          maxHp: 20,
          status: 'active',
          weaknesses: [
            { id: 'w1', label: 'fire', school: 'fire', revealed: true },
          ],
        },
        {
          id: 'e-wounded',
          name: 'Orc Warrior',
          role: 'elite',
          hp: 9,
          maxHp: 15,
          status: 'active',
          weaknesses: [
            { id: 'w2', label: 'holy', school: 'holy', revealed: true },
            { id: 'w3', label: 'frost', school: 'frost', revealed: false },
          ],
          effects: [{ id: 'ef1', name: 'Burning', description: 'On fire', kind: 'damage_over_time', remainingTurns: 2 }],
        },
        {
          id: 'e-staggering',
          name: 'Stone Golem',
          role: 'standard',
          hp: 5,
          maxHp: 16,
          status: 'active',
        },
        {
          id: 'e-nearly-broken',
          name: 'Skeleton Archer',
          role: 'minion',
          hp: 1,
          maxHp: 8,
          status: 'active',
        },
        {
          id: 'e-defeated',
          name: 'Cave Bat',
          role: 'minion',
          hp: 0,
          maxHp: 4,
          status: 'defeated',
        },
        {
          id: 'e-fled',
          name: 'Goblin Scout',
          role: 'minion',
          hp: 0,
          maxHp: 3,
          status: 'fled',
        },
      ],
      areas: [
        { id: 'a1', label: 'Torch Sconce', description: 'A lit torch on the wall', tags: ['fire', 'light'] },
        { id: 'a2', label: 'Broken Crates', description: 'Cover made of shattered wood', tags: ['cover'] },
      ],
    },
  };

  const fakeTurnResult = {
    id: 2,
    encounterId: fakeSession.encounterState.id,
    narration: 'The battle rages on inside the goblin caves.',
    choices: fakeSession.lastChoices,
    imagePrompt: null,
    imageSuggested: false,
    imageUrl: null,
  };

  await page.route(`**/api/session/${sessionId}`, route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(fakeSession),
  }));
  await page.route(`**/api/session/${sessionId}/history`, route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify([
      { ...fakeTurnResult, id: 1, narration: 'The party crashes into the goblin line.' },
      fakeTurnResult,
    ]),
  }));
  await page.route('**/api/sessions/events', route => route.abort());
  await page.route('**/api/capabilities', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ hasCloudAI: false, hasTts: false }),
  }));

  await page.goto(`/session/${sessionId}`);
  await dismissAudioOverlay(page);
  await expect(page.getByTestId('encounter-panel')).toBeVisible({ timeout: 10_000 });
  await screenshotViewports(page, 'session-encounter-panel');
});

test('session encounter panel - area card with image, effect, avatar, and lightbox', async ({ page }) => {
  const sessionId = 'visual-encounter-area-media';
  await suppressFirstRunOverlays(page);

  const fakeSession = {
    id: sessionId,
    scene: 'The Goblin King Caverns',
    sceneId: 'cave-1',
    turn: 8,
    displayName: 'Goblin King Encounter',
    savingsMode: true,
    gameMode: 'fast',
    difficulty: 'normal',
    tone: 'thrilling adventure',
    storySummary: 'The party stands before the Goblin King.',
    npcs: [],
    quests: [],
    recentHistory: ['The battle rages on inside the throne room.'],
    lastChoices: [
      { label: 'Strike with your weapon', difficulty: 'normal', stat: 'might', flavor: 'standard' },
      { label: 'Dodge and find an opening', difficulty: 'normal', stat: 'mischief', flavor: 'standard' },
    ],
    activeCharacterId: 'char-1',
    party: [{
      id: 'char-1',
      name: 'Barnabas Strongarm',
      class: 'Fighter',
      species: 'Dwarf',
      quirk: 'Talks to his axe like it is a person',
      hp: 7,
      max_hp: 10,
      status: 'active',
      stats: { might: 5, magic: 1, mischief: 1 },
      inventory: [],
    }],
    interventionState: { rescuesUsed: 0 },
    encounterState: {
      id: 'enc-goblin-king',
      name: "The Goblin King's Throne",
      status: 'active',
      round: 2,
      objective: 'Defeat the Goblin King and claim the stolen artifact',
      enemies: [
        {
          id: 'e1',
          name: 'Goblin King',
          role: 'boss',
          hp: 14,
          maxHp: 20,
          status: 'active',
          traits: ['crown thrower', 'commanding'],
          avatarUrl: '/images/default_scene.png',
          armor: 2,
          weaknesses: [{ id: 'w1', label: 'silver', school: 'silver', revealed: true }],
          effects: [{ id: 'ef1', name: 'Enraged', description: 'Attacks twice', kind: 'other', remainingTurns: 2 }],
        },
        {
          id: 'e2',
          name: 'Goblin Sentry',
          role: 'minion',
          hp: 2,
          maxHp: 5,
          status: 'active',
          traits: ['sneaky'],
        },
        {
          id: 'e3',
          name: 'Cave Bat',
          role: 'minion',
          hp: 0,
          maxHp: 3,
          status: 'defeated',
        },
      ],
      areas: [
        {
          id: 'a1',
          label: 'Throne Room',
          description: 'A cavernous chamber piled high with stolen loot and glittering junk. Rickety walkways circle a central pit.',
          tags: ['throne room', 'loot piles', 'open'],
          effect: 'Loose coins underfoot - anyone who sprints must roll or slip.',
          imageUrl: '/images/default_scene.png',
        },
        {
          id: 'a2',
          label: 'Pit Trap',
          description: 'A covered pit in the center of the throne room.',
          tags: ['hazard'],
        },
      ],
    },
  };

  const fakeTurnResult = {
    id: 2,
    encounterId: fakeSession.encounterState.id,
    narration: 'The battle rages on inside the throne room.',
    choices: fakeSession.lastChoices,
    imagePrompt: null,
    imageSuggested: false,
    imageUrl: null,
  };

  await page.route(`**/api/session/${sessionId}`, route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(fakeSession),
  }));
  await page.route(`**/api/session/${sessionId}/history`, route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify([
      { ...fakeTurnResult, id: 1, narration: 'The Goblin King springs from the throne.' },
      fakeTurnResult,
    ]),
  }));
  await page.route('**/api/sessions/events', route => route.abort());
  await page.route('**/api/capabilities', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ hasCloudAI: false, hasTts: false }),
  }));

  await page.goto(`/session/${sessionId}`);
  await dismissAudioOverlay(page);
  await expect(page.getByTestId('encounter-panel')).toBeVisible({ timeout: 10_000 });
  await screenshotViewports(page, 'session-encounter-panel-area-media');

  // Open the area lightbox - use desktop viewport where the encounter panel is visible
  // (on mobile the panel is hidden behind mobileActionsOpen overlay)
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole('button', { name: 'View Throne Room image' }).scrollIntoViewIfNeeded();
  await page.getByRole('button', { name: 'View Throne Room image' }).click();
  await expect(page.getByAltText('Throne Room').last()).toBeVisible();
  await screenshotViewports(page, 'session-encounter-area-lightbox');

  // Close lightbox
  await page.getByRole('button', { name: 'Close area lightbox' }).click();
  await expect(page.getByRole('button', { name: 'View Throne Room image' }).first()).toBeVisible();
});

test('session chronicle - encounter areas in combat log', async ({ page, request }) => {
  test.setTimeout(60_000);
  await suppressFirstRunOverlays(page);
  const session = await getSessionOrFail(request, SESSIONS.standard);
  await enableSavingsMode(request, session.id);

  await page.goto(`/session/${session.id}`);
  await dismissAudioOverlay(page);
  await waitForSessionReady(page);

  await page.keyboard.press('c');
  await expect(page.getByRole('heading', { name: 'Chronicle' })).toBeVisible();

  // Combat Log section is open by default and shows the seeded encounter with its area
  await expect(page.getByText("The Goblin King's Throne").first()).toBeVisible();
  await expect(page.getByText('Throne Room').first()).toBeVisible();

  await screenshotViewports(page, 'session-chronicle-encounter-areas');
});

test('session chronicle - encounter enemy changes in turn detail', async ({ page, request }) => {
  test.setTimeout(60_000);
  await suppressFirstRunOverlays(page);
  const session = await getSessionOrFail(request, SESSIONS.standard);
  await enableSavingsMode(request, session.id);

  const historyRes = await request.get(`/api/session/${session.id}/history`);
  const history = await historyRes.json() as { narration: string; encounterEnemyChanges?: unknown[] }[];

  const changeIdx = history.findIndex(t => Array.isArray(t.encounterEnemyChanges) && t.encounterEnemyChanges.length > 0);
  if (changeIdx === -1) {
    test.skip(true, 'No turns with encounter enemy changes in seed session');
    return;
  }

  await page.goto(`/session/${session.id}`);
  await dismissAudioOverlay(page);
  await waitForSessionReady(page);

  await page.keyboard.press('c');
  await expect(page.getByRole('heading', { name: 'Chronicle' })).toBeVisible();

  const turnButtons = page.locator('button').filter({ has: page.locator('p.italic') });
  await turnButtons.nth(changeIdx).scrollIntoViewIfNeeded();
  await turnButtons.nth(changeIdx).click();

  // Encounter badge and enemy change badges should be visible in the expanded turn
  await expect(page.getByText("The Goblin King's Throne").first()).toBeVisible();

  await screenshotViewports(page, 'session-chronicle-encounter-enemy-changes');
});
