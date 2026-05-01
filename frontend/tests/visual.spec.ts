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
    await expect(page).toHaveScreenshot(`${slug}-${vp.name}.png`, { fullPage: true });
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

test('seeded sessions', async ({ page, request }) => {
  const res = await request.get('/api/sessions');
  const sessions = await res.json() as { id: string; displayName: string }[];

  for (const session of sessions) {
    const slug = session.displayName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    await page.goto(`/session/${session.id}`);
    await dismissAudioOverlay(page);
    await screenshotViewports(page, `session-${slug}`);
  }
});
