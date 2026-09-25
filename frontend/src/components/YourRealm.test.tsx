import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NamespaceUsageResponse } from '../types';
import { YourRealm } from './YourRealm';

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }));

vi.mock('../lib/api', () => ({ apiFetch: mocks.apiFetch }));

const usage = (overrides: Partial<NamespaceUsageResponse>): NamespaceUsageResponse => ({
  tier: 'free',
  tierLabel: 'Adventurer',
  limits: { textCreditsPerDay: 150, picturesPerDay: 20, maxSessions: 3, maxTurns: 100 },
  today: { textCredits: 40, pictures: 20 },
  sessionCount: 1,
  resetsAt: '2026-09-26T00:00:00.000Z',
  picturesPaused: true,
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

  it('renders nothing when usage cannot be loaded', async () => {
    mocks.apiFetch.mockResolvedValue(new Response('{}', { status: 500 }));
    const { container } = render(<YourRealm />);
    await vi.waitFor(() => expect(container.textContent).toBe(''));
  });
});
