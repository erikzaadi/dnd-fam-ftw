import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthConfigResponse } from '../types';
import { TvSignIn } from './TvSignIn';

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  assign: vi.fn(),
  config: null as AuthConfigResponse | null,
}));

vi.mock('../lib/api', () => ({ apiFetch: mocks.apiFetch }));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ config: mocks.config }) }));

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const started = (userCode = 'WDJB-MJHT') => json({ userCode, expiresInSeconds: 600, intervalSeconds: 5 }, 202);

type DevicePollStatus = 'pending' | 'slow_down' | 'approved' | 'denied' | 'expired';

// Answers start with fresh codes and every poll with the given statuses, in order.
const serve = (...polls: DevicePollStatus[]) => {
  let starts = 0;
  mocks.apiFetch.mockImplementation((path: string) => Promise.resolve(path === '/auth/device/start'
    ? started(`CODE-000${++starts}`)
    : json({ status: polls.shift() ?? 'pending' })));
};

const renderTv = async () => {
  render(<MemoryRouter><TvSignIn /></MemoryRouter>);
  await act(() => vi.advanceTimersByTimeAsync(0));
};

const tick = () => act(() => vi.advanceTimersByTimeAsync(5000));

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.config = { enabled: true, signupMode: 'open', providers: { google: true, email: true }, deviceSignIn: true };
  Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, assign: mocks.assign } });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('TvSignIn', () => {
  it('shows the code and QR code, and reloads signed in once approved', async () => {
    serve('pending', 'approved');
    await renderTv();
    expect(screen.getByText('CODE-0001')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'QR code to approve this TV' })).toBeTruthy();
    await tick();
    expect(mocks.assign).not.toHaveBeenCalled();
    await tick();
    expect(mocks.assign).toHaveBeenCalledTimes(1);
  });

  it('gets a new code by itself three times, then asks', async () => {
    serve('expired', 'expired', 'expired', 'expired');
    await renderTv();
    for (let i = 2; i <= 4; i++) {
      await tick();
      expect(screen.getByText(`CODE-000${i}`)).toBeTruthy();
    }
    await tick();
    expect(screen.getByRole('alert').textContent).toBe('That code ran out.');
    fireEvent.click(screen.getByRole('button', { name: 'Get a new code' }));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(screen.getByText('CODE-0005')).toBeTruthy();
  });

  it('stops when the phone denies', async () => {
    serve('denied');
    await renderTv();
    await tick();
    expect(screen.getByRole('alert').textContent).toBe('The sign-in was turned down on the phone.');
    expect(screen.getByRole('button', { name: 'Get a new code' })).toBeTruthy();
  });

  it('starts nothing when TV sign-in is off', async () => {
    mocks.config = { ...mocks.config!, deviceSignIn: false };
    await renderTv();
    expect(mocks.apiFetch).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Sign in another way' })).toBeTruthy();
  });
});
