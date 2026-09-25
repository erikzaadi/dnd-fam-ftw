import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ComponentProps } from 'react';
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
          { label: 'Answer: a river', stat: 'mischief', difficulty: 'normal', difficultyValue: 12, kind: 'riddle_answer' },
          { label: 'Answer: a shadow', stat: 'mischief', difficulty: 'normal', difficultyValue: 12, kind: 'riddle_answer' },
          { label: 'Ask for a hint', stat: 'mischief', difficulty: 'easy', difficultyValue: 8 },
        ],
      },
    });

    expect(screen.getAllByText('Riddle Answer')).toHaveLength(2);
    expect(screen.getAllByText('No roll')).toHaveLength(2);
  });
});

describe('ActionDock numbers toggle', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('shows a plain risk word by default and hides roll targets and odds', () => {
    renderDock();
    expect(screen.getByText('Risky')).toBeInTheDocument();
    expect(screen.queryByText(/^vs \d+$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^\d+%$/)).not.toBeInTheDocument();
  });

  it('reveals the arithmetic on tap and remembers the choice', async () => {
    renderDock();
    await userEvent.click(screen.getByRole('button', { name: 'Show the numbers' }));
    expect(screen.getAllByText(/^vs \d+$/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^\d+%$/).length).toBe(3);
    expect(window.localStorage.getItem('dnd-fam-ftw:action-dock:show-numbers')).toBe('true');
    expect(screen.getByRole('button', { name: 'Hide the numbers' })).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('ActionDock clarification', () => {
  const QUESTION = 'Is "piano" your answer to the riddle?';

  // The draft is a controlled prop; keep it in state so the box behaves like the real page.
  const StatefulDock = ({ initial, onSubmit }: { initial: string; onSubmit: ComponentProps<typeof ActionDock>['onSubmit'] }) => {
    const [text, setText] = useState(initial);
    return (
      <ActionDock
        turn={TURN}
        loading={false}
        activeCharacter={ACTIVE_CHAR}
        isDown={false}
        party={[ACTIVE_CHAR]}
        sessionId="session-1"
        customAction={text}
        setCustomAction={setText}
        error={null}
        onSubmit={onSubmit}
        onShowPartyGear={vi.fn()}
      />
    );
  };

  beforeEach(() => {
    mocks.apiFetch.mockReset();
  });

  it('shows the question with the draft, then sends the reply together with the draft', async () => {
    mocks.apiFetch
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ kind: 'clarification', question: QUESTION, previewRevision: 3 }) })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ originalAction: 'I play the piano', interpretedAction: 'Alice answers: a piano', stat: 'magic', difficulty: 'normal', warnings: ['Riddle answer: no dice roll, the riddle decides.'], previewId: 'p1' }),
      });
    const onSubmit = vi.fn();
    render(<StatefulDock initial="I play the piano" onSubmit={onSubmit} />);

    await userEvent.click(screen.getByRole('button', { name: /unleash/i }));
    expect(await screen.findByText(QUESTION)).toBeInTheDocument();
    expect(screen.getByText('About: “I play the piano”')).toBeInTheDocument();
    const box = screen.getByPlaceholderText('Your answer...');
    expect(box).toHaveValue('');
    expect(screen.queryByRole('button', { name: /^confirm$/i })).not.toBeInTheDocument();

    await userEvent.type(box, 'Yes!');
    await userEvent.click(screen.getByRole('button', { name: /unleash/i }));

    const body = JSON.parse(mocks.apiFetch.mock.calls[1][1].body as string);
    expect(body).toEqual({ action: 'I play the piano', supports: ['clarification'], clarifications: [{ question: QUESTION, answer: 'Yes!' }] });
    await userEvent.click(await screen.findByRole('button', { name: /^confirm$/i }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith('Alice answers: a piano', 'magic', 'normal', undefined, undefined, undefined, undefined, { previewId: 'p1' });
    });
    expect(screen.queryByText(QUESTION)).not.toBeInTheDocument();
  });

  it('puts the draft back on Start over', async () => {
    mocks.apiFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ kind: 'clarification', question: QUESTION, previewRevision: 3 }) });
    render(<StatefulDock initial="I play the piano" onSubmit={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: /unleash/i }));
    await userEvent.click(await screen.findByRole('button', { name: /start over/i }));

    expect(screen.queryByText(QUESTION)).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('Describe a different action...')).toHaveValue('I play the piano');
  });

  it('shows a retryable explanation instead of a failed preview, keeping the draft', async () => {
    mocks.apiFetch.mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ error: 'riddle_answer_unknown', message: 'The DM is still puzzling over that riddle. Try again in a moment.' }) });
    render(<StatefulDock initial="The answer is a piano" onSubmit={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: /unleash/i }));

    expect(await screen.findByText('The DM is still puzzling over that riddle. Try again in a moment.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^confirm$/i })).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('Describe a different action...')).toHaveValue('The answer is a piano');
  });
});
