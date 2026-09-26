import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccessTokenCreatedResponse, AccessTokenListResponse, AccessTokenSummary, OAuthGrantSummary } from '../types';
import { AccessTokens } from './AccessTokens';

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }));

vi.mock('../lib/api', () => ({
  apiFetch: mocks.apiFetch,
  apiUrl: (path: string) => `/api${path}`,
  imgSrc: (url: string) => url,
}));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ enabled: true, user: { email: 'hero@example.com', namespaceId: 'ns' }, logout: vi.fn() }),
}));

const token = (overrides: Partial<AccessTokenSummary> = {}): AccessTokenSummary => ({
  id: 'tok1',
  label: 'Claude Code on the laptop',
  prefix: 'dndmcp_abc123',
  namespaceId: 'ns',
  namespaceName: 'The Burrow',
  scopes: ['adventures:read', 'adventures:play'],
  createdAt: '2026-09-20T10:00:00.000Z',
  expiresAt: '2099-10-20T10:00:00.000Z',
  lastUsedAt: null,
  revokedAt: null,
  ...overrides,
});

const list = (overrides: Partial<AccessTokenListResponse> = {}): AccessTokenListResponse => ({
  eligible: true,
  mcpAvailable: true,
  canRequestAccess: false,
  accessRequest: null,
  mcpUrl: 'https://api.example.com/mcp',
  namespaceName: 'The Burrow',
  maxActiveTokens: 5,
  tokens: [],
  ...overrides,
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

const renderPage = () => render(<MemoryRouter><AccessTokens /></MemoryRouter>);

// Token endpoints answer from the queue in order; the auto-confirm list and the header's
// realm list answer separately.
let queue: Response[] = [];
let autoConfirm: unknown = { adventures: [] };
let grants: OAuthGrantSummary[] = [];
const respondWith = (...responses: Response[]) => {
  queue = responses;
};

beforeEach(() => {
  vi.clearAllMocks();
  autoConfirm = { adventures: [] };
  grants = [];
  mocks.apiFetch.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/access-tokens/auto-confirm') {
      return json(autoConfirm);
    }
    if (path === '/access-tokens/grants') {
      return json(grants);
    }
    if (path.startsWith('/access-tokens/grants/')) {
      return json({ ok: true });
    }
    // The header's account menu lists the user's realms.
    if (path === '/auth/session/namespaces') {
      return json({ currentNamespaceId: 'ns', namespaces: [{ id: 'ns', name: 'The Burrow', isOwner: true }], canInvite: false });
    }
    if (path.startsWith('/access-tokens/auto-confirm/')) {
      return json({ id: 'adv1', enabled: JSON.parse(init?.body as string).enabled });
    }
    return queue.length > 1 ? queue.shift()! : queue[0].clone();
  });
});

const tokenCalls = () => mocks.apiFetch.mock.calls.filter(([path]) => String(path).startsWith('/access-tokens') && !String(path).startsWith('/access-tokens/auto-confirm') && !String(path).startsWith('/access-tokens/grants'));

describe('AccessTokens', () => {
  it('lets players without access request it, then shows the open request', async () => {
    respondWith(
      json(list({ eligible: false, mcpUrl: null, canRequestAccess: true })),
      json({ ok: true }, 201),
      json(list({ eligible: false, mcpUrl: null, accessRequest: { status: 'pending', createdAt: '2026-09-26T10:00:00.000Z' } })),
    );
    renderPage();
    fireEvent.change(await screen.findByLabelText(/Anything to add/), { target: { value: 'Claude Code please' } });
    expect(screen.queryByRole('button', { name: 'Create token' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Request access' }));
    expect(await screen.findByText(/You asked for assistant access on/)).toBeTruthy();
    const [path, init] = tokenCalls()[1];
    expect(path).toBe('/access-tokens/request');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ note: 'Claude Code please' });
  });

  it('shows the server message when a request is refused', async () => {
    respondWith(
      json(list({ eligible: false, mcpUrl: null, canRequestAccess: true })),
      json({ error: 'too_many_requests', message: 'You can ask 3 times a month. Try again later.' }, 429),
    );
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Request access' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/3 times a month/);
  });

  it('offers no request when access is blocked or MCP is off', async () => {
    respondWith(json(list({ eligible: false, mcpUrl: null, canRequestAccess: false })));
    const { unmount } = renderPage();
    expect(await screen.findByText(/not available for your account/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Request access' })).toBeNull();
    unmount();
    respondWith(json(list({ eligible: false, mcpAvailable: false, mcpUrl: null })));
    renderPage();
    expect(await screen.findByText(/turned off on this server/)).toBeTruthy();
  });

  it('shows a new secret once with setup instructions', async () => {
    const created: AccessTokenCreatedResponse = { token: token(), secret: 'dndmcp_supersecretvalue' };
    respondWith(json(list()), json(created, 201), json(list({ tokens: [token()] })));
    renderPage();
    fireEvent.change(await screen.findByLabelText(/Name/), { target: { value: 'Claude Code on the laptop' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create token' }));
    expect(await screen.findByText('dndmcp_supersecretvalue')).toBeTruthy();
    expect(screen.getAllByText(/https:\/\/api\.example\.com\/mcp/).length).toBeGreaterThan(0);
    const [, init] = tokenCalls()[1] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ label: 'Claude Code on the laptop', scopes: ['adventures:play', 'adventures:create'] });

    fireEvent.click(screen.getByRole('button', { name: 'I saved it' }));
    expect(screen.queryByText('dndmcp_supersecretvalue')).toBeNull();
  });

  it('lists tokens and revokes after confirmation', async () => {
    respondWith(json(list({ tokens: [token()] })), json({ ok: true }), json(list({ tokens: [token({ revokedAt: '2026-09-26T10:00:00.000Z' })] })));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke' }));
    const dialog = screen.getByText(/Assistants using it stop working right away/).parentElement!;
    fireEvent.click(within(dialog).getByRole('button', { name: 'Revoke' }));
    expect(await screen.findByText('revoked')).toBeTruthy();
    expect(tokenCalls()[1][0]).toBe('/access-tokens/tok1/revoke');
  });

  it('lists connected assistants and disconnects one after confirmation', async () => {
    grants = [{
      id: 'ogr_1', clientName: 'Claude Code', verifiedHost: 'claude.ai', namespaceId: 'ns', namespaceName: 'The Burrow',
      scopes: ['adventures:read', 'adventures:play'], createdAt: '2026-09-20T10:00:00.000Z', expiresAt: '2099-10-20T10:00:00.000Z',
      lastUsedAt: null, revokedAt: null,
    }];
    respondWith(json(list()));
    renderPage();
    expect(await screen.findByText(/Verified app from claude\.ai/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    const dialog = screen.getByText(/It stops working right away/).parentElement!;
    fireEvent.click(within(dialog).getByRole('button', { name: 'Disconnect' }));
    await vi.waitFor(() => expect(mocks.apiFetch.mock.calls.some(([path]) => path === '/access-tokens/grants/ogr_1/revoke')).toBe(true));
  });

  it('lets a pilot user choose to be asked before every action in one adventure', async () => {
    autoConfirm = { adventures: [{ id: 'adv1', title: 'Troll Bridge', enabled: true }] };
    respondWith(json(list()));
    renderPage();
    const toggle = await screen.findByRole('checkbox', { name: 'Send clean actions after an Undo window in Troll Bridge' });
    expect((toggle as HTMLInputElement).checked).toBe(true);
    fireEvent.click(toggle);
    expect((toggle as HTMLInputElement).checked).toBe(false);
    const call = mocks.apiFetch.mock.calls.find(([path]) => path === '/access-tokens/auto-confirm/adv1') as [string, RequestInit];
    expect(JSON.parse(call[1].body as string)).toEqual({ enabled: false });
  });
});
