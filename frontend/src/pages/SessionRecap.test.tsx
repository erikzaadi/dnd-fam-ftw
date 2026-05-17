import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionRecap } from './SessionRecap';

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  apiFetch: mocks.apiFetch,
  imgSrc: (url: string | null | undefined) => url ?? '/images/default_scene.png',
}));

vi.mock('../components/SiteHeader', () => ({ SiteHeader: () => null }));
vi.mock('../components/DmFooter', () => ({ DmFooter: () => null }));
vi.mock('../components/FullscreenImage', () => ({ FullscreenImage: () => null }));
vi.mock('../components/game/SceneBackground', () => ({ SceneBackground: () => null }));
vi.mock('../components/KeybindingsHelp', () => ({ KeybindingsHelp: () => null }));
vi.mock('../components/NarrationTtsButton', () => ({ NarrationTtsButton: () => null }));
vi.mock('../audio/audioManager', () => ({
  audioManager: { startAmbientMusic: vi.fn(), stopMusic: vi.fn() },
}));
vi.mock('../tts/narrationTtsService', () => ({
  narrationTtsService: {
    isNarrationAvailable: () => false,
    speakNarration: vi.fn(),
    stopNarration: vi.fn(),
  },
}));
vi.mock('../tts/useTtsSettings', () => ({
  useTtsSettings: () => ({ settings: { enabled: false } }),
}));
vi.mock('../hooks/useCapabilities', () => ({
  useCapabilities: () => ({ capabilities: { hasTts: false, hasCloudAI: true } }),
}));

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => mocks.navigate,
    useParams: () => ({ id: 'test-session-id' }),
  };
});

const makeJsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

const baseSession = {
  id: 'test-session-id',
  displayName: 'Test Realm',
  scene: 'A place',
  turn: 1,
  party: [
    {
      id: 'c1',
      name: 'Brom',
      class: 'Fighter',
      species: 'Human',
      quirk: 'likes boulders',
      hp: 10,
      max_hp: 10,
      stats: { might: 5, magic: 1, mischief: 1 },
      inventory: [],
      buffs: [],
      status: 'active',
    },
  ],
  activeCharacterId: 'c1',
  savingsMode: false,
  gameOver: false,
  interventionState: { rescuesUsed: 0 },
  previewImageUrl: '/images/preview.png',
};

const renderPage = () =>
  render(
    <MemoryRouter>
      <SessionRecap />
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SessionRecap - zero history sessions', () => {
  it('shows the origin view instead of navigating immediately when there is no turn history', async () => {
    mocks.apiFetch.mockImplementation((url: string) => {
      if (url === '/session/test-session-id') {
        return Promise.resolve(makeJsonResponse(baseSession));
      }
      if (url === '/session/test-session-id/history') {
        return Promise.resolve(makeJsonResponse([]));
      }
      if (url === '/session/test-session-id/origin-story') {
        return Promise.resolve(makeJsonResponse({ originStory: 'Before the adventure, four wanderers met.' }));
      }
      return Promise.resolve(makeJsonResponse({}));
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('How It Began')).toBeInTheDocument();
    });
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('generates origin story lazily when GET returns null', async () => {
    mocks.apiFetch.mockImplementation((url: string, opts?: RequestInit) => {
      if (url === '/session/test-session-id') {
        return Promise.resolve(makeJsonResponse(baseSession));
      }
      if (url === '/session/test-session-id/history') {
        return Promise.resolve(makeJsonResponse([]));
      }
      if (url === '/session/test-session-id/origin-story' && !opts?.method) {
        return Promise.resolve(makeJsonResponse({ originStory: null }));
      }
      if (url === '/session/test-session-id/origin-story' && opts?.method === 'POST') {
        return Promise.resolve(makeJsonResponse({ originStory: 'Generated: the tale begins here.' }));
      }
      return Promise.resolve(makeJsonResponse({}));
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Generated: the tale begins here.')).toBeInTheDocument();
    });
  });

  it('navigates to session when Begin Adventure is clicked', async () => {
    mocks.apiFetch.mockImplementation((url: string) => {
      if (url === '/session/test-session-id') {
        return Promise.resolve(makeJsonResponse(baseSession));
      }
      if (url === '/session/test-session-id/history') {
        return Promise.resolve(makeJsonResponse([]));
      }
      if (url === '/session/test-session-id/origin-story') {
        return Promise.resolve(makeJsonResponse({ originStory: 'A tale of courage.' }));
      }
      return Promise.resolve(makeJsonResponse({}));
    });

    renderPage();

    const btn = await screen.findByRole('button', { name: /begin adventure/i });
    fireEvent.click(btn);

    expect(mocks.navigate).toHaveBeenCalledWith('/session/test-session-id');
  });

  it('does not show Begin Adventure for fallen (gameOver) sessions', async () => {
    const fallenSession = { ...baseSession, gameOver: true };
    mocks.apiFetch.mockImplementation((url: string) => {
      if (url === '/session/test-session-id') {
        return Promise.resolve(makeJsonResponse(fallenSession));
      }
      if (url === '/session/test-session-id/history') {
        return Promise.resolve(makeJsonResponse([]));
      }
      if (url === '/session/test-session-id/origin-story') {
        return Promise.resolve(makeJsonResponse({ originStory: 'A legend that ended.' }));
      }
      return Promise.resolve(makeJsonResponse({}));
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('How It Began')).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /begin adventure/i })).toBeNull();
    expect(screen.getByRole('button', { name: /view chronicle/i })).toBeInTheDocument();
  });
});

describe('SessionRecap - sessions with history', () => {
  const turnHistory = [
    {
      id: 'turn-1',
      narration: 'The adventure began.',
      choices: [],
      encounterId: null,
      imageUrl: null,
      lastAction: null,
    },
  ];

  it('shows the recap chooser when there is turn history', async () => {
    mocks.apiFetch.mockImplementation((url: string) => {
      if (url === '/session/test-session-id') {
        return Promise.resolve(makeJsonResponse(baseSession));
      }
      if (url === '/session/test-session-id/history') {
        return Promise.resolve(makeJsonResponse(turnHistory));
      }
      return Promise.resolve(makeJsonResponse({}));
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/how would you like to catch up/i)).toBeInTheDocument();
    });
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('shows Origin option in chooser for fallen sessions with an origin story', async () => {
    const fallenSession = {
      ...baseSession,
      gameOver: true,
      originStory: 'Before the fall, heroes gathered.',
    };
    mocks.apiFetch.mockImplementation((url: string) => {
      if (url === '/session/test-session-id') {
        return Promise.resolve(makeJsonResponse(fallenSession));
      }
      if (url === '/session/test-session-id/history') {
        return Promise.resolve(makeJsonResponse(turnHistory));
      }
      return Promise.resolve(makeJsonResponse({}));
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Origin')).toBeInTheDocument();
    });
  });

  it('does not show Origin option for active (non-gameOver) sessions', async () => {
    const sessionWithOrigin = { ...baseSession, originStory: 'The story so far.' };
    mocks.apiFetch.mockImplementation((url: string) => {
      if (url === '/session/test-session-id') {
        return Promise.resolve(makeJsonResponse(sessionWithOrigin));
      }
      if (url === '/session/test-session-id/history') {
        return Promise.resolve(makeJsonResponse(turnHistory));
      }
      return Promise.resolve(makeJsonResponse({}));
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/how would you like to catch up/i)).toBeInTheDocument();
    });
    expect(screen.queryByText('Origin')).toBeNull();
  });
});
