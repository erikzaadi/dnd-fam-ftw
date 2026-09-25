import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthConfigResponse } from '../types';
import { Login } from './Login';

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  navigate: vi.fn(),
  config: null as AuthConfigResponse | null,
}));

vi.mock('../lib/api', () => ({
  apiFetch: mocks.apiFetch,
  apiUrl: (path: string) => path,
}));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ config: mocks.config }),
}));

vi.mock('../components/SiteHeader', () => ({ SiteHeader: () => null }));
vi.mock('../components/DmFooter', () => ({ DmFooter: () => null }));

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => mocks.navigate };
});

const renderLogin = (path = '/login') => render(
  <MemoryRouter initialEntries={[path]}>
    <Login />
  </MemoryRouter>,
);

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  mocks.config = { enabled: true, signupMode: 'open', providers: { google: true, email: true } };
});

describe('Login', () => {
  it('offers email codes and Google when both are configured', () => {
    renderLogin();
    expect(screen.getByRole('button', { name: 'Email me a code' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Continue with Google/ })).toBeTruthy();
    expect(screen.getByText('New here? Verify your email and start playing.')).toBeTruthy();
  });

  it('shows only Google when email sign-in is not configured', () => {
    mocks.config = { enabled: true, signupMode: 'invite_only', providers: { google: true, email: false } };
    renderLogin();
    expect(screen.queryByRole('button', { name: 'Email me a code' })).toBeNull();
    expect(screen.getByRole('button', { name: /Sign in with Google/ })).toBeTruthy();
  });

  it('starts an email sign-in and moves to the code screen', async () => {
    mocks.apiFetch.mockResolvedValue(new Response(JSON.stringify({
      challengeId: 'challenge-1', maskedEmail: 'h***@example.com', resendAfterSeconds: 60, expiresInSeconds: 600,
    }), { status: 202 }));
    renderLogin();
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'hero@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Email me a code' }));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/verify-email'));
    expect(JSON.parse(sessionStorage.getItem('emailSignIn')!)).toMatchObject({ challengeId: 'challenge-1', email: 'hero@example.com' });
  });

  it('explains a rate limit without leaving the page', async () => {
    mocks.apiFetch.mockResolvedValue(new Response(JSON.stringify({ error: 'rate_limited', retryAfterSeconds: 120 }), { status: 429 }));
    renderLogin();
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'hero@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Email me a code' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Too many codes requested. Try again in 2 minutes.');
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('asks new Google users to create their account with an email code', () => {
    renderLogin('/login?error=use_email_code');
    expect(screen.getByText('New here? Create your account with an email code first. After that, Google sign-in works too.')).toBeTruthy();
  });
});
