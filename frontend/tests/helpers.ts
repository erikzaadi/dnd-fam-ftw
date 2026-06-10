import { expect, type APIRequestContext, type Page } from '@playwright/test';

export const SESSIONS = {
  standard: 'seed-session-1',
  dragonPeak: 'seed-session-2',
  inventory: 'seed-session-1',
  characterPopup: 'seed-session-3',
  chronicle: 'seed-session-1',
  fallen: 'seed-session-6',
  storyRealm: 'seed-session-5',
  mechanicsShowcase: 'seed-session-7',
} as const;

export type SessionListItem = { id: string; displayName: string; gameOver?: boolean };
export type VisualCharacter = { id: string; name: string; status?: string };
export type SessionDetail = {
  id: string;
  activeCharacterId?: string;
  party: VisualCharacter[];
};

export async function dismissAudioOverlay(page: Page): Promise<void> {
  const btn = page.getByRole('button', { name: 'Enable Audio' });
  try {
    await btn.waitFor({ state: 'visible', timeout: 2000 });
    await btn.click();
  } catch {
    // overlay not present
  }
}

export async function waitForSessionReady(page: Page): Promise<void> {
  // Session screenshots should not capture transient image-generation state.
  try {
    await page.getByText('Painting the scene...').waitFor({ state: 'hidden', timeout: 30_000 });
  } catch {
    // not present or already gone
  }
}

export async function getSessionOrFail(request: APIRequestContext, id: string): Promise<SessionListItem> {
  const res = await request.get('/api/sessions');
  expect(res.ok()).toBe(true);
  const sessions = await res.json() as SessionListItem[];
  const session = sessions.find(s => s.id === id);
  if (!session) {
    throw new Error(`Seed session ${id} was not found. Run "cd backend && npm run cli -- sessions seed" against the visual-test database before updating snapshots.`);
  }
  return session;
}

export async function setSavingsMode(request: APIRequestContext, sessionId: string, enabled: boolean): Promise<void> {
  const res = await request.post(`/api/session/${sessionId}/savings-mode`, {
    data: { enabled },
  });
  expect(res.ok()).toBe(true);
}

export async function enableSavingsMode(request: APIRequestContext, sessionId: string): Promise<void> {
  await setSavingsMode(request, sessionId, true);
}

export async function getSessionDetailOrFail(request: APIRequestContext, id: string): Promise<SessionDetail> {
  const res = await request.get(`/api/session/${id}`);
  expect(res.ok()).toBe(true);
  return await res.json() as SessionDetail;
}

// Suppress first-run overlays in visual tests. Each test calls this
// before page.goto() so the initScript fires before React mounts.
export async function suppressFirstRunOverlays(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('tutorial_ever_started', '1');
    localStorage.setItem('dnd-first-run-wizard', JSON.stringify({ completedVersion: 1 }));
  });
}

// Suppress the per-page setup tutorial overlays (home, new session, assembly).
export async function suppressSetupTutorials(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('home_tutorial_done', '1');
    localStorage.setItem('new_session_tutorial_done', '1');
    localStorage.setItem('character_assembly_tutorial_done', '1');
  });
}

// Stop CSS animations/transitions for stable plain page.screenshot() captures
// (toHaveScreenshot has animations: 'disabled'; page.screenshot does not).
export async function freezeAnimations(page: Page): Promise<void> {
  await page.addStyleTag({
    content: '*, *::before, *::after { animation: none !important; transition: none !important; }',
  });
}

export async function setupCarModeRoutes(page: Page, sessionId: string): Promise<void> {
  await page.route(`**/api/session/${sessionId}`, route => {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: sessionId,
        displayName: 'Car Mode Adventure',
        scene: 'The Whispering Forest',
        turn: 1,
        activeCharacterId: 'char-1',
        party: [
          {
            id: 'char-1',
            name: 'Barnabas Strongarm',
            class: 'Barbarian',
            species: 'Human',
            hp: 10,
            max_hp: 10,
            status: 'active',
            inventory: [],
          },
        ],
      }),
    });
  });
  await page.route(`**/api/session/${sessionId}/history`, route => {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: 1,
          narration: 'You hear a low growl from the dark trees.',
          choices: [
            { label: 'Draw your sword', difficulty: 'normal', stat: 'might' },
            { label: 'Sneak past the bushes', difficulty: 'hard', stat: 'mischief' },
          ],
        },
      ]),
    });
  });
  await page.route('**/api/capabilities', route => {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ hasCloudAI: true, hasTts: true }),
    });
  });
}
