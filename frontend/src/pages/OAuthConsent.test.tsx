import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OAuthConsentDetailsResponse } from '../types';
import { OAuthConsent } from './OAuthConsent';

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }));

vi.mock('../lib/api', () => ({
  apiFetch: mocks.apiFetch,
  apiUrl: (path: string) => `/api${path}`,
  imgSrc: (url: string) => url,
}));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ enabled: true, user: { email: 'hero@example.com', namespaceId: 'ns1' }, logout: vi.fn() }),
}));

const details = (overrides: Partial<OAuthConsentDetailsResponse> = {}): OAuthConsentDetailsResponse => ({
  client: { name: 'Claude Code', verifiedHost: null, redirectHost: '127.0.0.1:41234' },
  requestedScopes: ['adventures:read', 'adventures:play'],
  realms: [{ id: 'ns1', name: 'The Burrow', eligible: true }, { id: 'ns2', name: 'Cousins', eligible: false }],
  currentNamespaceId: 'ns1',
  expiresAt: '2099-01-01T00:00:00.000Z',
  ...overrides,
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

// Answers by path: the header (account menu) makes its own requests on mount.
let consentGet: Response;
let consentPost: Response;
const consentPostCalls = () => mocks.apiFetch.mock.calls.filter(([path, init]) => path === '/oauth-consent/req123' && (init as RequestInit | undefined)?.method === 'POST');
const respond = (get: Response, post: Response = json({ error: 'unexpected' }, 500)) => {
  consentGet = get;
  consentPost = post;
};
const assign = vi.fn();
const originalLocation = window.location;

const renderPage = () => render(<MemoryRouter initialEntries={['/oauth/consent?request=req123']}><OAuthConsent /></MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.apiFetch.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/oauth-consent/req123') {
      return init?.method === 'POST' ? consentPost : consentGet;
    }
    return json({ currentNamespaceId: 'ns1', namespaces: [], canInvite: false });
  });
  Object.defineProperty(window, 'location', { configurable: true, value: { ...originalLocation, assign } });
});

afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
});

describe('OAuthConsent', () => {
  it('approves with the chosen realm and scopes, then returns to the app', async () => {
    respond(json(details()), json({ redirectUrl: 'http://127.0.0.1:41234/callback?code=c' }));
    renderPage();
    expect(await screen.findByText(/Unverified app/)).toBeTruthy();
    expect((screen.getByRole('option', { name: /Cousins/ }) as HTMLOptionElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('Start new adventures'));
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith('http://127.0.0.1:41234/callback?code=c'));
    const [, init] = consentPostCalls()[0];
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ decision: 'approve', namespaceId: 'ns1', scopes: ['adventures:play', 'adventures:create'] });
  });

  it('denies', async () => {
    respond(json(details({ client: { name: 'Codex', verifiedHost: 'openai.com', redirectHost: 'localhost:1455' } })), json({ redirectUrl: 'http://localhost:1455/cb?error=access_denied' }));
    renderPage();
    expect(await screen.findByText('Verified app from openai.com')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith('http://localhost:1455/cb?error=access_denied'));
    expect(JSON.parse((consentPostCalls()[0][1] as RequestInit).body as string)).toEqual({ decision: 'deny' });
  });

  it('points players without assistant access to the request page and offers only Deny', async () => {
    respond(json(details({ realms: [{ id: 'ns1', name: 'The Burrow', eligible: false }] })));
    renderPage();
    expect(await screen.findByText(/not on for you in any of your realms/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Allow' })).toBeNull();
  });

  it('explains an expired request', async () => {
    respond(json({ error: 'not_found', message: 'This sign-in request has expired or was already answered.' }, 404));
    renderPage();
    expect((await screen.findByRole('alert')).textContent).toMatch(/expired/);
  });
});
