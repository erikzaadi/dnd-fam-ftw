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
    // These tests exercise the confirm dialog; clean previews would otherwise auto-send.
    window.localStorage.setItem('dnd-fam-ftw:action-dock:always-confirm', 'true');
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
    expect(screen.getByLabelText('What do you try?')).not.toHaveFocus();
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

    expect(screen.getByLabelText('What do you try?')).toHaveFocus();
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

  it('shows roll targets and odds by default', () => {
    renderDock();
    expect(screen.getAllByText(/^vs \d+$/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^\d+%$/).length).toBe(3);
    expect(screen.getByRole('button', { name: 'Hide the numbers' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('hides the arithmetic on tap, keeps the risk word, and remembers the choice', async () => {
    renderDock();
    await userEvent.click(screen.getByRole('button', { name: 'Hide the numbers' }));
    expect(screen.getByText('Risky')).toBeInTheDocument();
    expect(screen.queryByText(/^vs \d+$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^\d+%$/)).not.toBeInTheDocument();
    expect(window.localStorage.getItem('dnd-fam-ftw:action-dock:show-numbers')).toBe('false');
    expect(screen.getByRole('button', { name: 'Show the numbers' })).toHaveAttribute('aria-pressed', 'false');
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
    expect(screen.getByLabelText('What do you try?')).toHaveValue('I play the piano');
  });

  it('moves focus to the answer box, describes it with the question, and starts over on Escape', async () => {
    mocks.apiFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ kind: 'clarification', question: QUESTION, previewRevision: 3 }) });
    render(<StatefulDock initial="I play the piano" onSubmit={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: /unleash/i }));
    const box = await screen.findByLabelText('Your answer to the DM');
    await waitFor(() => expect(box).toHaveFocus());
    expect(box).toHaveAccessibleDescription(QUESTION);

    fireEvent.keyDown(box, { key: 'Escape' });

    expect(screen.queryByText(QUESTION)).not.toBeInTheDocument();
    expect(screen.getByLabelText('What do you try?')).toHaveValue('I play the piano');
    expect(screen.getByLabelText('What do you try?')).toHaveFocus();
  });

  it('shows a retryable explanation instead of a failed preview, keeping the draft', async () => {
    mocks.apiFetch.mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ error: 'riddle_answer_unknown', message: 'The DM is still puzzling over that riddle. Try again in a moment.' }) });
    render(<StatefulDock initial="The answer is a piano" onSubmit={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: /unleash/i }));

    expect(await screen.findByText('The DM is still puzzling over that riddle. Try again in a moment.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^confirm$/i })).not.toBeInTheDocument();
    expect(screen.getByLabelText('What do you try?')).toHaveValue('The answer is a piano');
  });
});

describe('ActionDock ideas on request', () => {
  const EMPTY_TURN: TurnResult = { ...TURN, id: 7, choices: [] };
  const PAYLOAD = {
    turnId: 7,
    revision: 3,
    characterId: 'alice',
    degraded: false,
    choices: [{ id: 91, label: 'Sneak past the cook', stat: 'mischief' as const, difficulty: 'normal' as const }],
  };

  beforeEach(() => {
    mocks.apiFetch.mockReset();
  });

  it('puts the text box first and offers ideas when there are none', () => {
    renderDock({ turn: EMPTY_TURN, revision: 3 });

    expect(screen.getByLabelText('What do you try?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Give me ideas' })).toBeInTheDocument();
    expect(screen.queryByText('Ideas')).not.toBeInTheDocument();
  });

  it('asks for ideas for the latest turn and hands them to the page', async () => {
    mocks.apiFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => PAYLOAD });
    const onIdeas = vi.fn();
    renderDock({ turn: EMPTY_TURN, revision: 3, onIdeas });

    await userEvent.click(screen.getByRole('button', { name: 'Give me ideas' }));

    expect(mocks.apiFetch.mock.calls[0][0]).toBe('/session/session-1/ideas');
    expect(JSON.parse(mocks.apiFetch.mock.calls[0][1].body as string)).toEqual({ turnId: 7, revision: 3 });
    await waitFor(() => expect(onIdeas).toHaveBeenCalledWith(PAYLOAD));
  });

  it('shows the reason and a retry when ideas fail, keeping the draft', async () => {
    mocks.apiFetch.mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({ error: 'ideas_rate_limited', message: 'Lots of ideas already!' }) });
    renderDock({ turn: EMPTY_TURN, revision: 3, customAction: 'I hum a tune' });

    await userEvent.click(screen.getByRole('button', { name: 'Give me ideas' }));

    expect(await screen.findByText('Lots of ideas already!')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.getByLabelText('What do you try?')).toHaveValue('I hum a tune');
  });

  it('hides ideas that went stale, and offers new ones', () => {
    renderDock({ turn: { ...TURN, id: 7, ideasRevision: 3, ideasCharacterId: 'alice' }, revision: 4 });

    expect(screen.queryByRole('button', { name: /Kick the door/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Give me ideas' })).toBeInTheDocument();
  });

  it('shows current ideas as cards', () => {
    renderDock({ turn: { ...TURN, id: 7, ideasRevision: 4, ideasCharacterId: 'alice' }, revision: 4 });

    expect(screen.getByText('Ideas')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Kick the door/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Give me ideas' })).not.toBeInTheDocument();
  });

  it('offers one try-again for fallback ideas', async () => {
    mocks.apiFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => PAYLOAD });
    renderDock({ turn: { ...TURN, id: 7, ideasRevision: 3, ideasDegraded: true }, revision: 3, onIdeas: vi.fn() });

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(JSON.parse(mocks.apiFetch.mock.calls[0][1].body as string)).toEqual({ turnId: 7, revision: 3, retry: true });
  });
});

describe('ActionDock gear attached to the draft', () => {
  const ATTACHMENT = { actionType: 'use_item' as const, itemId: 'potion-1', ownerCharacterId: 'alice', label: 'Healing Potion' };

  beforeEach(() => {
    mocks.apiFetch.mockReset();
  });

  it('shows the gear as a removable chip', async () => {
    const onClearAttachment = vi.fn();
    renderDock({ attachment: ATTACHMENT, onClearAttachment, customAction: 'Alice uses Healing Potion' });

    expect(screen.getByText('Gear: Healing Potion')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Remove Healing Potion from the action' }));
    expect(onClearAttachment).toHaveBeenCalled();
  });

  it('sends the gear with the preview and confirms it without a roll', async () => {
    mocks.apiFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ originalAction: 'Alice uses Healing Potion', interpretedAction: 'Alice uses Healing Potion', stat: 'mischief', difficulty: 'easy', warnings: [], previewId: 'p-item', itemAction: { kind: 'item_use', itemName: 'Healing Potion', ownerName: 'Alice' } }),
    });
    const onSubmit = vi.fn();
    const onClearAttachment = vi.fn();
    renderDock({ attachment: ATTACHMENT, onClearAttachment, onSubmit, customAction: 'Alice uses Healing Potion' });

    await userEvent.click(screen.getByRole('button', { name: /unleash/i }));
    expect(JSON.parse(mocks.apiFetch.mock.calls[0][1].body as string).attachment).toEqual({ actionType: 'use_item', itemId: 'potion-1', ownerCharacterId: 'alice' });
    expect(await screen.findByText(/No roll/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /^confirm$/i }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith('Alice uses Healing Potion', 'none', 'easy', undefined, undefined, undefined, undefined, { previewId: 'p-item' });
    });
    expect(onClearAttachment).toHaveBeenCalled();
  });
});

describe('ActionDock one-tap free actions', () => {
  const CLEAN = { originalAction: 'I juggle apples', interpretedAction: 'Alice juggles three apples', stat: 'mischief', difficulty: 'normal', warnings: [], previewId: 'p-clean' };

  beforeEach(() => {
    window.localStorage.clear();
    mocks.apiFetch.mockReset();
  });

  it('sends a clean typed action after the undo window, without the dialog', async () => {
    mocks.apiFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => CLEAN });
    const onSubmit = vi.fn();
    renderDock({ customAction: 'I juggle apples', onSubmit, autoSendDelayMs: 20 });

    await userEvent.click(screen.getByRole('button', { name: /unleash/i }));

    expect(await screen.findByText('Alice juggles three apples')).toBeInTheDocument();
    expect(screen.queryByText('Confirm your action')).not.toBeInTheDocument();
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith('Alice juggles three apples', 'mischief', 'normal', undefined, undefined, undefined, undefined, { previewId: 'p-clean' });
    });
  });

  it('takes the action back on Undo, keeping the draft', async () => {
    mocks.apiFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => CLEAN });
    const onSubmit = vi.fn();
    renderDock({ customAction: 'I juggle apples', onSubmit, autoSendDelayMs: 60_000 });

    await userEvent.click(screen.getByRole('button', { name: /unleash/i }));
    await userEvent.click(await screen.findByRole('button', { name: /^Undo/ }));

    expect(screen.queryByText('Alice juggles three apples')).not.toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByLabelText('What do you try?')).toHaveValue('I juggle apples');
  });

  it('still asks when the preview has warnings', async () => {
    mocks.apiFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ...CLEAN, warnings: ['That sounds like a guaranteed outcome.'] }) });
    renderDock({ customAction: 'I juggle apples', autoSendDelayMs: 20 });

    await userEvent.click(screen.getByRole('button', { name: /unleash/i }));

    expect(await screen.findByText('Confirm your action')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Undo/ })).not.toBeInTheDocument();
  });

  it('asks every time once the viewer turns on "Ask before sending", and remembers it', async () => {
    mocks.apiFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => CLEAN });
    renderDock({ customAction: 'I juggle apples', autoSendDelayMs: 20 });

    await userEvent.click(screen.getByRole('button', { name: 'Ask before sending' }));
    await userEvent.click(screen.getByRole('button', { name: /unleash/i }));

    expect(await screen.findByText('Confirm your action')).toBeInTheDocument();
    expect(window.localStorage.getItem('dnd-fam-ftw:action-dock:always-confirm')).toBe('true');
  });
});

describe('ActionDock keyboard shortcuts', () => {
  const CLEAN = { originalAction: 'I juggle apples', interpretedAction: 'Alice juggles three apples', stat: 'mischief', difficulty: 'normal', warnings: [], previewId: 'p-keys' };

  beforeEach(() => {
    window.localStorage.clear();
    mocks.apiFetch.mockReset();
  });

  it('u unleashes the typed draft', async () => {
    mocks.apiFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => CLEAN });
    renderDock({ customAction: 'I juggle apples', autoSendDelayMs: 60_000 });

    fireEvent.keyDown(window, { key: 'u' });

    expect(await screen.findByText('Alice juggles three apples')).toBeInTheDocument();
    expect(mocks.apiFetch.mock.calls[0][0]).toBe('/session/session-1/preview-action');
  });

  it('g asks for ideas when there are none', async () => {
    mocks.apiFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ turnId: 7, revision: 3, characterId: 'alice', degraded: false, choices: [] }) });
    renderDock({ turn: { ...TURN, id: 7, choices: [] }, revision: 3, onIdeas: vi.fn() });

    fireEvent.keyDown(window, { key: 'g' });

    await waitFor(() => expect(mocks.apiFetch.mock.calls[0][0]).toBe('/session/session-1/ideas'));
  });

  it('Escape undoes a pending send, even from the text box', async () => {
    mocks.apiFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => CLEAN });
    const onSubmit = vi.fn();
    renderDock({ customAction: 'I juggle apples', onSubmit, autoSendDelayMs: 60_000 });

    await userEvent.click(screen.getByRole('button', { name: /unleash/i }));
    await screen.findByText('Alice juggles three apples');
    fireEvent.keyDown(screen.getByLabelText('What do you try?'), { key: 'Escape' });

    expect(screen.queryByText('Alice juggles three apples')).not.toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});


describe('ActionDock Ask the DM', () => {
  const ASK_TURN: TurnResult = { ...TURN, id: 7 };

  beforeEach(() => {
    mocks.apiFetch.mockReset();
  });

  it('answers a typed question without taking a turn, then frees the box', async () => {
    mocks.apiFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ turnId: 7, revision: 3, question: 'Can I climb the wall?', answer: 'The wall is slick, but Alice could try her rope.' }),
    });
    const setCustomAction = vi.fn();
    const onSubmit = vi.fn();
    renderDock({ turn: ASK_TURN, customAction: 'Can I climb the wall?', setCustomAction, onSubmit, revision: 3 });

    await userEvent.click(screen.getByRole('button', { name: 'Ask the DM instead' }));

    expect(await screen.findByText('The wall is slick, but Alice could try her rope.')).toBeInTheDocument();
    expect(mocks.apiFetch.mock.calls[0][0]).toBe('/session/session-1/ask');
    expect(JSON.parse(mocks.apiFetch.mock.calls[0][1].body as string)).toEqual({ question: 'Can I climb the wall?', turnId: 7, revision: 3 });
    expect(setCustomAction).toHaveBeenCalledWith('');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('keeps the question in the box when the DM cannot answer', async () => {
    mocks.apiFetch.mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({ error: 'ask_rate_limited', message: 'Lots of questions already!' }) });
    const setCustomAction = vi.fn();
    renderDock({ turn: ASK_TURN, customAction: 'Can I climb the wall?', setCustomAction, revision: 3 });

    await userEvent.click(screen.getByRole('button', { name: 'Ask the DM instead' }));

    expect(await screen.findByText('Lots of questions already!')).toBeInTheDocument();
    expect(setCustomAction).not.toHaveBeenCalled();
  });
});
