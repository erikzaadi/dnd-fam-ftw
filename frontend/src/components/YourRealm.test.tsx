import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NamespaceUsageResponse } from '../types';
import { YourRealm } from './YourRealm';

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }));

vi.mock('../lib/api', () => ({ apiFetch: mocks.apiFetch }));

const usage = (overrides: Partial<NamespaceUsageResponse>): NamespaceUsageResponse => ({
  tier: 'free',
  tierLabel: 'Adventurer',
  tierExpiresAt: null,
  limits: { textCreditsPerDay: 150, picturesPerDay: 20, maxSessions: 3, maxTurns: 100 },
  today: { textCredits: 40, pictures: 20 },
  sessionCount: 1,
  resetsAt: '2026-09-26T00:00:00.000Z',
  picturesPaused: true,
  supportUrl: null,
  donationUpgradeDays: null,
  limitRequest: null,
  ...overrides,
});

const respond = (body: NamespaceUsageResponse) => {
  mocks.apiFetch.mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('YourRealm', () => {
  it('shows the tier, energy and picture meters, and adventures for a limited group', async () => {
    respond(usage({}));
    render(<YourRealm />);
    expect(await screen.findByText('Adventurer')).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: 'Adventure energy' }).getAttribute('aria-valuenow')).toBe('40');
    expect(screen.getByRole('progressbar', { name: 'Pictures' }).getAttribute('aria-valuenow')).toBe('20');
    expect(screen.getByText('1 / 3')).toBeTruthy();
  });

  it('shows no meters for an unlimited group', async () => {
    respond(usage({ tier: 'unlimited', tierLabel: 'Founding Realm', limits: { textCreditsPerDay: null, picturesPerDay: null, maxSessions: null, maxTurns: null } }));
    render(<YourRealm />);
    expect(await screen.findByText('Founding Realm')).toBeTruthy();
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.getByText('Your realm has no daily limits. Adventure as much as you like.')).toBeTruthy();
  });

  it('offers support and ask-for-more to a limited group', async () => {
    respond(usage({ supportUrl: 'https://ko-fi.com/example' }));
    render(<YourRealm />);
    const support = await screen.findByRole('link', { name: 'Support the realm' });
    expect(support.getAttribute('href')).toBe('https://ko-fi.com/example');
    expect(screen.getByRole('button', { name: 'Ask for more' })).toBeTruthy();
  });

  it('explains donation matching and shows when a donation upgrade ends', async () => {
    respond(usage({ tier: 'supporter', tierLabel: 'Patron of the Realm', tierExpiresAt: '2026-12-25T12:00:00.000Z', supportUrl: 'https://ko-fi.com/example', donationUpgradeDays: 90 }));
    render(<YourRealm />);
    expect(await screen.findByText(/higher limits last until/)).toBeTruthy();
    expect(screen.getByText('When the realm owner donates with the email they sign in with, this realm gets higher limits for 90 days.')).toBeTruthy();
  });

  it('hides the support link when none is configured and shows a pending request', async () => {
    respond(usage({ limitRequest: { status: 'pending', createdAt: '2026-09-25 10:00:00' } }));
    render(<YourRealm />);
    expect(await screen.findByText("Your request is with the realm keeper. You'll get more once it's approved.")).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Support the realm' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Ask for more' })).toBeNull();
  });

  it('renders nothing when usage cannot be loaded', async () => {
    mocks.apiFetch.mockResolvedValue(new Response('{}', { status: 500 }));
    const { container } = render(<YourRealm />);
    await vi.waitFor(() => expect(container.textContent).toBe(''));
  });
});
