import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccessTokenCreatedResponse, AccessTokenListResponse, AccessTokenSummary } from '../types';
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
  mcpUrl: 'https://api.example.com/mcp',
  namespaceName: 'The Burrow',
  maxActiveTokens: 5,
  tokens: [],
  ...overrides,
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

const renderPage = () => render(<MemoryRouter><AccessTokens /></MemoryRouter>);

// Token endpoints answer from the queue in order; the auto-confirm list answers separately.
let queue: Response[] = [];
let autoConfirm: unknown = { adventures: [] };
const respondWith = (...responses: Response[]) => {
  queue = responses;
};

beforeEach(() => {
  vi.clearAllMocks();
  autoConfirm = { adventures: [] };
  mocks.apiFetch.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/access-tokens/auto-confirm') {
      return json(autoConfirm);
    }
    if (path.startsWith('/access-tokens/auto-confirm/')) {
      return json({ id: 'adv1', enabled: JSON.parse(init?.body as string).enabled });
    }
    return queue.length > 1 ? queue.shift()! : queue[0].clone();
  });
});

const tokenCalls = () => mocks.apiFetch.mock.calls.filter(([path]) => !String(path).startsWith('/access-tokens/auto-confirm'));

describe('AccessTokens', () => {
  it('explains the invite-only pilot to users outside it', async () => {
    respondWith(json(list({ eligible: false, mcpUrl: null })));
    renderPage();
    expect(await screen.findByText(/invite-only while we try it out/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Create token' })).toBeNull();
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
