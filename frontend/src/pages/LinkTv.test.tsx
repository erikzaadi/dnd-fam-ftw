import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { peekPostLoginPath } from '../lib/postLoginRedirect';
import { LinkTv } from './LinkTv';

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  auth: {} as Record<string, unknown>,
}));

vi.mock('../lib/api', () => ({ apiFetch: mocks.apiFetch }));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => mocks.auth }));
vi.mock('../components/SiteHeader', () => ({ SiteHeader: () => null }));

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const config = { enabled: true, signupMode: 'open', providers: { google: false, email: true }, deviceSignIn: true };
const signedIn = { enabled: true, loading: false, config, user: { email: 'hero@example.com', namespaceId: 'ns-a', deviceSession: false } };

const renderLink = (path: string) => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path="/link" element={<LinkTv />} />
      <Route path="/login" element={<p>login page</p>} />
    </Routes>
  </MemoryRouter>,
);

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  mocks.auth = signedIn;
  mocks.apiFetch.mockImplementation((path: string) => Promise.resolve(
    path === '/auth/session/namespaces'
      ? json({ currentNamespaceId: 'ns-a', namespaces: [{ id: 'ns-a', name: 'Home', isOwner: true }, { id: 'ns-b', name: 'Cousins', isOwner: false }], canInvite: true })
      : path === '/auth/device/lookup'
        ? json({ deviceLabel: 'Samsung TV browser', createdAt: Date.now(), expiresAt: Date.now() + 600_000 })
        : json({ deviceLabel: 'Living room', signedOutLabel: 'Old TV' }),
  ));
});

describe('LinkTv', () => {
  it('sends a signed-out phone to sign in and remembers the code', () => {
    mocks.auth = { enabled: true, loading: false, config, user: null };
    renderLink('/link?code=wdjb-mjht');
    expect(screen.getByText('login page')).toBeTruthy();
    expect(peekPostLoginPath()).toBe('/link?code=WDJB-MJHT');
  });

  it('looks up the code from the QR link and approves it for the chosen realm', async () => {
    renderLink('/link?code=WDJB-MJHT');
    expect(await screen.findByText('Does your TV show this code?')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Realm'), { target: { value: 'ns-b' } });
    fireEvent.change(screen.getByLabelText('Name this TV (optional)'), { target: { value: 'Living room' } });
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText('The TV is signed in. You can put your phone away.')).toBeTruthy();
    expect(screen.getByText(/"Old TV" was signed out/)).toBeTruthy();
    const approve = mocks.apiFetch.mock.calls.find(([path]) => path === '/auth/device/approve');
    expect(JSON.parse(approve![1].body as string)).toEqual({ code: 'WDJB-MJHT', namespaceId: 'ns-b', label: 'Living room' });
  });

  it('explains an unknown code and lets the player retype it', async () => {
    mocks.apiFetch.mockImplementation((path: string) => Promise.resolve(path === '/auth/device/lookup'
      ? json({ error: 'invalid_code' }, 400)
      : json({ currentNamespaceId: 'ns-a', namespaces: [], canInvite: false })));
    renderLink('/link');
    fireEvent.change(screen.getByLabelText('TV code'), { target: { value: 'bcdfghjk' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/doesn't match a TV/));
    expect((screen.getByLabelText('TV code') as HTMLInputElement).value).toBe('BCDF-GHJK');
  });
});
