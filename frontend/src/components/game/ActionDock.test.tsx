import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ActionDock } from './ActionDock';
import type { Character, TurnResult } from '../../types';

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  sttEnabled: false,
  speechSupported: true,
  speechState: { status: 'idle' } as { status: 'idle' } | { status: 'error'; message: string },
  startListening: vi.fn(),
  stopTts: vi.fn(),
}));

vi.mock('../../lib/api', () => ({
  apiFetch: mocks.apiFetch,
  imgSrc: (url: string | null | undefined) => url ?? '/images/default_scene.png',
  pulseSyncDelay: () => '0ms',
}));

vi.mock('../../tts/useTtsSettings', () => ({
  useTtsSettings: () => ({ settings: { enabled: false } }),
}));

vi.mock('../../tts/browserTtsService', () => ({
  browserTtsService: {
    isSupported: () => false,
    stop: mocks.stopTts,
    speakNarration: vi.fn(),
  },
}));

vi.mock('../../stt/useSttSettings', () => ({
  useSttSettings: () => ({ settings: { enabled: mocks.sttEnabled } }),
}));

vi.mock('../../stt/useSpeechRecognition', () => ({
  useSpeechRecognition: () => ({
    isSupported: mocks.speechSupported,
    state: mocks.speechState,
    transcript: '',
    errorMessage: mocks.speechState.status === 'error' ? mocks.speechState.message : null,
    startListening: mocks.startListening,
    stopListening: vi.fn(),
    confirmTranscript: vi.fn(),
    retryListening: vi.fn(),
    cancel: vi.fn(),
    reset: vi.fn(),
  }),
}));

const ACTIVE_CHAR: Character = {
  id: 'alice',
  name: 'Alice',
  class: 'Mage',
  species: 'Human',
  quirk: 'sparkly',
  hp: 10,
  max_hp: 10,
  status: 'active',
  avatarUrl: '/alice.png',
  stats: { might: 1, magic: 3, mischief: 2 },
  inventory: [],
};

const TURN: TurnResult = {
  narration: 'A door blocks the way.',
  imagePrompt: null,
  imageSuggested: false,
  choices: [
    { label: 'Kick the door', stat: 'might', difficulty: 'normal' },
    { label: 'Charm the lock', stat: 'magic', difficulty: 'easy' },
    { label: 'Sneak around', stat: 'mischief', difficulty: 'hard' },
  ],
};

const renderDock = (overrides: Partial<ComponentProps<typeof ActionDock>> = {}) => {
  const props: ComponentProps<typeof ActionDock> = {
    turn: TURN,
    loading: false,
    activeCharacter: ACTIVE_CHAR,
    isDown: false,
    party: [ACTIVE_CHAR],
    sessionId: 'session-1',
    customAction: '',
    setCustomAction: vi.fn(),
    error: null,
    onSubmit: vi.fn(),
    onShowPartyGear: vi.fn(),
    ...overrides,
  };
  render(<ActionDock {...props} />);
  return props;
};

describe('ActionDock speech input', () => {
  beforeEach(() => {
    mocks.apiFetch.mockReset();
    mocks.apiFetch.mockResolvedValue({ ok: true, json: async () => ({ stat: 'magic' }) });
    mocks.sttEnabled = false;
    mocks.speechSupported = true;
    mocks.speechState = { status: 'idle' };
    mocks.startListening.mockReset();
    mocks.stopTts.mockReset();
  });

  it('hides the voice button when the global STT setting is disabled', () => {
    renderDock();
    expect(screen.queryByRole('button', { name: /start voice action/i })).not.toBeInTheDocument();
  });

  it('starts voice input from the button when enabled and supported', async () => {
    mocks.sttEnabled = true;
    renderDock();

    await userEvent.click(screen.getByRole('button', { name: /start voice action/i }));

    expect(mocks.stopTts).toHaveBeenCalled();
    expect(mocks.startListening).toHaveBeenCalled();
  });

  it('starts voice input with the v key only when available', () => {
    mocks.sttEnabled = true;
    renderDock();

    fireEvent.keyDown(window, { key: 'v' });

    expect(mocks.startListening).toHaveBeenCalled();
  });

  it('does not start voice input with the v key when the global setting is disabled', () => {
    renderDock();

    fireEvent.keyDown(window, { key: 'v' });

    expect(mocks.startListening).not.toHaveBeenCalled();
  });

  it('keeps manual custom action submission working', async () => {
    const setCustomAction = vi.fn();
    const onSubmit = vi.fn();
    renderDock({ customAction: 'cast shield', setCustomAction, onSubmit });

    await userEvent.click(screen.getByRole('button', { name: /unleash/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith('cast shield', 'magic', 'normal');
    });
  });
});

