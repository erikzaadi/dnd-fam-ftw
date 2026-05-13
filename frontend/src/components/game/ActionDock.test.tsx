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
    expect(onSubmit).not.toHaveBeenCalled();
    await userEvent.click(await screen.findByRole('button', { name: /^confirm$/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith('cast shield', 'magic', 'normal', undefined, undefined, undefined, undefined, {});
    });
  });

  it('passes free-text bonus preview from the stat suggestion response', async () => {
    mocks.apiFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        stat: 'mischief',
        characterBonus: 2,
        characterBonusLabel: 'social edge',
        flavor: 'social',
      }),
    });
    const onSubmit = vi.fn();
    renderDock({ customAction: 'talk down the guard', onSubmit });

    await userEvent.click(screen.getByRole('button', { name: /unleash/i }));
    await userEvent.click(await screen.findByRole('button', { name: /^confirm$/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        'talk down the guard',
        'mischief',
        'normal',
        undefined,
        undefined,
        undefined,
        undefined,
        { characterBonus: 2, characterBonusLabel: 'social edge', flavor: 'social' },
      );
    });
  });

  it('does not submit when editing a previewed custom action', async () => {
    mocks.apiFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        originalAction: 'cast shield',
        interpretedAction: 'cast shield',
        stat: 'magic',
        difficulty: 'normal',
        warnings: [],
      }),
    });
    const setCustomAction = vi.fn();
    const onSubmit = vi.fn();
    renderDock({ customAction: 'cast sheld', setCustomAction, onSubmit });

    await userEvent.click(screen.getByRole('button', { name: /unleash/i }));
    await userEvent.click(await screen.findByRole('button', { name: /^edit$/i }));

    expect(setCustomAction).toHaveBeenCalledWith('cast sheld');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('can force the original custom action text when confirming', async () => {
    mocks.apiFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        originalAction: 'cast shield',
        interpretedAction: 'cast shield',
        stat: 'magic',
        difficulty: 'normal',
        warnings: [],
      }),
    });
    const onSubmit = vi.fn();
    renderDock({ customAction: 'cast sheld', onSubmit });

    await userEvent.click(screen.getByRole('button', { name: /unleash/i }));
    await userEvent.click(await screen.findByLabelText(/force original text/i));
    await userEvent.click(screen.getByRole('button', { name: /^confirm$/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        'cast sheld',
        'magic',
        'normal',
        undefined,
        undefined,
        undefined,
        undefined,
        {},
      );
    });
  });

  it('does not submit when canceling a previewed custom action', async () => {
    const onSubmit = vi.fn();
    renderDock({ customAction: 'cast shield', onSubmit });

    await userEvent.click(screen.getByRole('button', { name: /unleash/i }));
    await userEvent.click(await screen.findByRole('button', { name: /^cancel$/i }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /^confirm$/i })).not.toBeInTheDocument();
  });

  it('uses the fourth numeric shortcut for the fourth suggested action', () => {
    renderDock({
      turn: {
        ...TURN,
        choices: [
          ...TURN.choices,
          { label: 'Duck under the counterweights', stat: 'might', difficulty: 'hard' },
        ],
      },
    });

    fireEvent.keyDown(window, { key: '4' });

    expect(screen.getByRole('button', { name: /Duck under the counterweights/i })).toHaveFocus();
    expect(screen.getByPlaceholderText('Describe a different action...')).not.toHaveFocus();
  });

  it('moves the custom action shortcut after the suggested actions', () => {
    renderDock({
      turn: {
        ...TURN,
        choices: [
          ...TURN.choices,
          { label: 'Duck under the counterweights', stat: 'might', difficulty: 'hard' },
        ],
      },
    });

    fireEvent.keyDown(window, { key: '5' });

    expect(screen.getByPlaceholderText('Describe a different action...')).toHaveFocus();
  });

  it('shows riddle answer choices as no-roll answers', () => {
    renderDock({
      turn: {
        ...TURN,
        choices: [
          { label: 'Answer: a river', stat: 'mischief', difficulty: 'normal', difficultyValue: 12, riddleAnswer: 'a river', riddleCorrect: true },
          { label: 'Answer: a shadow', stat: 'mischief', difficulty: 'normal', difficultyValue: 12, riddleAnswer: 'a shadow', riddleCorrect: false },
          { label: 'Ask for a hint', stat: 'mischief', difficulty: 'easy', difficultyValue: 8 },
        ],
      },
    });

    expect(screen.getAllByText('Riddle Answer')).toHaveLength(2);
    expect(screen.getAllByText('No roll')).toHaveLength(2);
  });
});
