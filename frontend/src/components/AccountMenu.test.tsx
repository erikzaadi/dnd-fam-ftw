import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionNamespacesResponse } from '../types';
import { AccountMenu } from './AccountMenu';

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  switchNamespace: vi.fn(),
  logout: vi.fn(),
}));

vi.mock('../lib/api', () => ({ apiFetch: mocks.apiFetch, switchNamespace: mocks.switchNamespace }));
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { email: 'hero@example.com', namespaceId: 'ns-a' }, logout: mocks.logout }),
}));

const realms = (body: SessionNamespacesResponse) => {
  mocks.apiFetch.mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
};

const renderAt = (path: string) => render(
  <MemoryRouter initialEntries={[path]}>
    <AccountMenu />
  </MemoryRouter>,
);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.switchNamespace.mockResolvedValue(true);
});

describe('AccountMenu', () => {
  it('shows the current realm and switches to another one', async () => {
    realms({ currentNamespaceId: 'ns-a', namespaces: [{ id: 'ns-a', name: 'Home Realm', isOwner: true }, { id: 'ns-b', name: 'Cousins', isOwner: false }] });
    renderAt('/');
    fireEvent.click(await screen.findByRole('button', { name: 'Account menu' }));
    expect(await screen.findByText('Home Realm', { selector: 'div' })).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: /Cousins/ }));
    expect(mocks.switchNamespace).toHaveBeenCalledWith('ns-b');
  });

  it('offers no switching with a single realm', async () => {
    realms({ currentNamespaceId: 'ns-a', namespaces: [{ id: 'ns-a', name: 'Home Realm', isOwner: true }] });
    renderAt('/');
    fireEvent.click(await screen.findByRole('button', { name: 'Account menu' }));
    expect(screen.queryByText('Switch realm')).toBeNull();
    expect(screen.getByRole('menuitem', { name: /Sign out/ })).toBeTruthy();
  });

  it('asks before switching away from unsaved setup work', async () => {
    realms({ currentNamespaceId: 'ns-a', namespaces: [{ id: 'ns-a', name: 'Home Realm', isOwner: true }, { id: 'ns-b', name: 'Cousins', isOwner: false }] });
    renderAt('/create-session');
    fireEvent.click(await screen.findByRole('button', { name: 'Account menu' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Cousins/ }));
    expect(mocks.switchNamespace).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Switch realm' }));
    expect(mocks.switchNamespace).toHaveBeenCalledWith('ns-b');
  });

  it('keeps the menu open with an error when the switch fails', async () => {
    mocks.switchNamespace.mockResolvedValue(false);
    realms({ currentNamespaceId: 'ns-a', namespaces: [{ id: 'ns-a', name: 'Home Realm', isOwner: true }, { id: 'ns-b', name: 'Cousins', isOwner: false }] });
    renderAt('/');
    fireEvent.click(await screen.findByRole('button', { name: 'Account menu' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Cousins/ }));
    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});
