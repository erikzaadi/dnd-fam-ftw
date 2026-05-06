import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GetMeRollin } from './GetMeRollin';

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  navigate: vi.fn(),
}));

const makeLocalStorage = () => {
  const store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value; 
    },
    removeItem: (key: string) => {
      delete store[key]; 
    },
    clear: () => {
      for (const k of Object.keys(store)) {
        delete store[k]; 
      } 
    },
  };
};

let ls: ReturnType<typeof makeLocalStorage>;

vi.mock('../lib/api', () => ({
  apiFetch: mocks.apiFetch,
  imgSrc: (url: string | null | undefined) => url ?? '/images/default_scene.png',
}));

vi.mock('../components/SiteHeader', () => ({ SiteHeader: () => null }));
vi.mock('../components/DmFooter', () => ({ DmFooter: () => null }));

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => mocks.navigate,
  };
});

const renderPage = () =>
  render(
    <MemoryRouter>
      <GetMeRollin />
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  ls = makeLocalStorage();
  Object.defineProperty(window, 'localStorage', { configurable: true, value: ls });
});

describe('GetMeRollin', () => {
  it('renders the page heading and concept cards', () => {
    renderPage();
    expect(screen.getByText(/Get Me Rollin'/i)).toBeInTheDocument();
    expect(screen.getByText('The Story Box')).toBeInTheDocument();
    expect(screen.getByText('The Party Box')).toBeInTheDocument();
    expect(screen.getByText('The Action Dock')).toBeInTheDocument();
    expect(screen.getByText('The Roll')).toBeInTheDocument();
  });

  it('shows loading text while the request is in flight', async () => {
    let resolve!: (v: Response) => void;
    mocks.apiFetch.mockReturnValue(new Promise<Response>(r => {
      resolve = r; 
    }));
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /Let's Roll!/i }));

    expect(await screen.findByText(/they waitin'/i)).toBeInTheDocument();

    await act(async () => {
      resolve(new Response(JSON.stringify({ id: 'abc' }), { status: 200 }));
    });
  });

  it('shows a session limit error on 403 session_limit', async () => {
    mocks.apiFetch.mockResolvedValue(
      new Response(JSON.stringify({ error: 'session_limit', message: 'Group limit reached.' }), { status: 403 }),
    );
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /Let's Roll!/i }));

    expect(await screen.findByText('Group limit reached.')).toBeInTheDocument();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('shows a generic error on non-ok response', async () => {
    mocks.apiFetch.mockResolvedValue(
      new Response(JSON.stringify({ error: 'server_error' }), { status: 500 }),
    );
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /Let's Roll!/i }));

    expect(await screen.findByText(/something went wrong/i)).toBeInTheDocument();
  });

  it('sets localStorage tutorial step and navigates on success', async () => {
    mocks.apiFetch.mockResolvedValue(
      new Response(JSON.stringify({ id: 'new-session-id' }), { status: 200 }),
    );
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /Let's Roll!/i }));

    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/session/new-session-id'));
    expect(ls.getItem('onboarding_tutorial_step')).toBe('1');
  });

  it('dismisses the error when the close button is clicked', async () => {
    mocks.apiFetch.mockResolvedValue(
      new Response(JSON.stringify({ error: 'session_limit', message: 'At capacity.' }), { status: 403 }),
    );
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /Let's Roll!/i }));
    await screen.findByText('At capacity.');

    fireEvent.click(screen.getByRole('button', { name: '✕' }));
    expect(screen.queryByText('At capacity.')).toBeNull();
  });
});
