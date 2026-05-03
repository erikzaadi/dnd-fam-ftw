import { test, expect, type Page } from '@playwright/test';

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

async function dismissAudioOverlay(page: Page): Promise<void> {
  const btn = page.getByRole('button', { name: 'Enable Audio' });
  try {
    await btn.waitFor({ state: 'visible', timeout: 2000 });
    await btn.click();
  } catch {
    // overlay not present
  }
}

async function screenshotViewports(page: Page, slug: string): Promise<void> {
  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await expect(page).toHaveScreenshot(`${slug}-${vp.name}.png`, {
      fullPage: true,
      animations: 'disabled',
    });
  }
}

test('home', async ({ page }) => {
  await page.goto('/');
  await dismissAudioOverlay(page);
  await screenshotViewports(page, 'home');
});

test('settings', async ({ page }) => {
  await page.goto('/settings');
  await dismissAudioOverlay(page);
  await screenshotViewports(page, 'settings');
});

test('session banner hidden', async ({ page, request }) => {
  test.setTimeout(60_000);
  const res = await request.get('/api/sessions');
  const sessions = await res.json() as { id: string; displayName: string; gameOver?: boolean }[];
  const session = sessions.find(s => !s.gameOver);
  if (!session) {
    test.skip();
    return;
  }
  await page.goto(`/session/${session.id}`);
  await dismissAudioOverlay(page);
  await page.getByRole('button', { name: 'Hide banner' }).click();
  await screenshotViewports(page, 'session-banner-hidden');
});

test('session narration fullscreen', async ({ page, request }) => {
  test.setTimeout(60_000);
  const res = await request.get('/api/sessions');
  const sessions = await res.json() as { id: string; displayName: string; gameOver?: boolean }[];
  const session = sessions.find(s => !s.gameOver);
  if (!session) {
    test.skip();
    return;
  }

  const historyRes = await request.get(`/api/session/${session.id}/history`);
  const history = await historyRes.json() as { narration: string }[];
  if (history.length === 0) {
    test.skip();
    return;
  }

  await page.goto(`/session/${session.id}`);
  await dismissAudioOverlay(page);
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
  await screenshotViewports(page, 'session-narration-fullscreen-closed');
});

test('session chronicle open and second turn', async ({ page, request }) => {
  test.setTimeout(60_000);
  const res = await request.get('/api/sessions');
  const sessions = await res.json() as { id: string; displayName: string; gameOver?: boolean }[];
  const session = sessions.find(s => !s.gameOver);
  if (!session) {
    test.skip();
    return;
  }

  const [historyRes, sessionRes] = await Promise.all([
    request.get(`/api/session/${session.id}/history`),
    request.get(`/api/session/${session.id}`),
  ]);
  const history = await historyRes.json() as { narration: string }[];
  const fullSession = await sessionRes.json() as { party: { name: string }[] };

  if (history.length < 2) {
    test.skip();
    return;
  }

  // Chronicle shows newest first, so second item = history[length - 2]
  const secondTurnNarration = history[history.length - 2].narration;

  await page.goto(`/session/${session.id}`);
  await dismissAudioOverlay(page);

  // Verify party count and names via avatar alt text in the HUD
  for (const member of fullSession.party) {
    await expect(page.getByAltText(member.name).first()).toBeVisible();
  }

  const chronicleLink = page.getByRole('button', { name: /Open Chronicle/i });
  await chronicleLink.scrollIntoViewIfNeeded();
  await expect(chronicleLink).toBeVisible();
  await chronicleLink.click();

  await expect(page.getByRole('heading', { name: 'Chronicle' })).toBeVisible();

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
  const res = await request.get('/api/sessions');
  const sessions = await res.json() as { id: string; displayName: string; gameOver?: boolean }[];

  let sessionId: string | null = null;
  let inventoryItems: string[] = [];
  let partyMembers: string[] = [];

  for (const s of sessions) {
    if (s.gameOver) {
      continue;
    }
    const fullRes = await request.get(`/api/session/${s.id}`);
    const full = await fullRes.json() as { party?: { name: string; inventory?: { id: string; name: string }[] }[] };
    const items = full.party?.flatMap(c => c.inventory ?? []) ?? [];
    if (items.length > 0) {
      sessionId = s.id;
      inventoryItems = items.map(item => item.name);
      partyMembers = full.party?.map(c => c.name) ?? [];
      break;
    }
  }

  if (!sessionId) {
    test.skip();
    return;
  }

  await page.goto(`/session/${sessionId}`);
  await dismissAudioOverlay(page);

  // Verify party count and names via avatar alt text in the HUD
  for (const name of partyMembers) {
    await expect(page.getByAltText(name).first()).toBeVisible();
  }

  await page.getByRole('button', { name: 'Show party gear' }).click();

  for (const itemName of inventoryItems) {
    await expect(page.getByText(itemName)).toBeVisible();
  }

  await screenshotViewports(page, 'session-inventory');
});

test('seeded sessions', async ({ page, request }) => {
  test.setTimeout(120_000);
  const res = await request.get('/api/sessions');
  const all = await res.json() as { id: string; displayName: string; gameOver?: boolean }[];

  const gameOver = all.find(s => s.gameOver);
  const dragonPeak = all.find(s => !s.gameOver && s.displayName.toLowerCase().includes('dragon'));
  const other = all.find(s => !s.gameOver && s.id !== dragonPeak?.id);

  const picks = [gameOver, dragonPeak, other].filter(Boolean) as typeof all;

  for (const session of picks) {
    const historyRes = await request.get(`/api/session/${session.id}/history`);
    const history = await historyRes.json() as { narration: string }[];
    const lastNarration = history[history.length - 1]?.narration ?? null;

    const slug = session.displayName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    await page.goto(`/session/${session.id}`);
    await dismissAudioOverlay(page);

    // Game-over sessions show a "Campaign Over" screen without the narration text
    if (lastNarration && !session.gameOver) {
      await expect(page.getByText(lastNarration.slice(0, 60), { exact: false }).first()).toBeVisible({ timeout: 15_000 });
    }

    await screenshotViewports(page, `session-${slug}`);
  }
});
