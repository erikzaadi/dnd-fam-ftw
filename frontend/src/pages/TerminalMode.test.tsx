import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { TerminalMode } from './TerminalMode';
import { useCarSessionRuntime } from '../session/car/useCarSessionRuntime';
import { askDm } from '../lib/askDm';
import type { Session, TurnResult, FreeActionPreview } from '../types';

vi.mock('../session/car/useCarSessionRuntime', () => ({
  useCarSessionRuntime: vi.fn(),
}));

vi.mock('../lib/askDm', () => ({
  askDm: vi.fn(),
}));

describe('TerminalMode', () => {
  const mockSubmitAction = vi.fn().mockResolvedValue(undefined);
  const mockSubmitChoice = vi.fn().mockResolvedValue(undefined);
  const mockRequestIdeas = vi.fn();
  const mockPreviewAction = vi.fn().mockResolvedValue(undefined);
  const mockClearPreview = vi.fn();

  const mockSession: Session = {
    id: 'session-id-123',
    displayName: 'Test D&D Campaign',
    scene: 'Volcanic Dungeon Entrance',
    turn: 3,
    savingsMode: false,
    interventionState: { rescuesUsed: 0 },
    activeCharacterId: 'char-1',
    party: [
      {
        id: 'char-1',
        name: 'Grom',
        class: 'Fighter',
        species: 'Orc',
        quirk: 'Stubborn',
        hp: 12,
        max_hp: 15,
        status: 'active',
        stats: { might: 3, magic: 0, mischief: 1 },
        inventory: [{ id: 'i1', name: 'Iron Shield', description: 'Heavy shield' }],
      },
    ],
  };

  const mockHistory: TurnResult[] = [
    {
      id: 1,
      narration: 'The heavy iron door blocks your path.',
      choices: [
        { id: 41, label: 'Bash it down', stat: 'might', difficulty: 'hard' },
        { label: 'Pick the lock', stat: 'mischief', difficulty: 'normal' },
      ],
      imagePrompt: null,
      imageSuggested: false,
    },
  ];

  let capturedOnPreviewReady: ((preview: FreeActionPreview) => void) | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    capturedOnPreviewReady = undefined;

    vi.mocked(useCarSessionRuntime).mockImplementation(({ onPreviewReady }) => {
      capturedOnPreviewReady = onPreviewReady;
      return {
        session: mockSession,
        history: mockHistory,
        loading: false,
        actionError: null,
        connectionState: 'connected',
        prevEncounterStatus: 'none',
        submitAction: mockSubmitAction,
        submitChoice: mockSubmitChoice,
        previewAction: mockPreviewAction,
        actionPreview: null,
        clearPreview: mockClearPreview,
        previewThinking: false,
        ideas: mockHistory[0].choices,
        requestIdeas: mockRequestIdeas,
      } as unknown as ReturnType<typeof useCarSessionRuntime>;
    });
  });

  const renderComponent = () => {
    return render(
      <MemoryRouter initialEntries={['/session/session-id-123/terminal']}>
        <Routes>
          <Route path="/session/:id/terminal" element={<TerminalMode />} />
        </Routes>
      </MemoryRouter>
    );
  };

  it('renders terminal layout and initial history', () => {
    renderComponent();

    // Check status bar details
    expect(screen.getByText(/\[SESSION: TEST D&D CAMPAIGN\]/i)).toBeInTheDocument();
    expect(screen.getByText(/\[TURN: 3\]/i)).toBeInTheDocument();
    expect(screen.getByText(/\[MODE: EXPLORATION\]/i)).toBeInTheDocument();
    expect(screen.getByText(/CONNECTED/i)).toBeInTheDocument();

    // Check initial logs content
    expect(screen.getByText(/Adventure Shell Ready. Session: Test D&D Campaign./i)).toBeInTheDocument();
    expect(screen.getByText(/The heavy iron door blocks your path./i)).toBeInTheDocument();
    expect(screen.getByText(/1. Bash it down/i)).toBeInTheDocument();
    expect(screen.getByText(/2. Pick the lock/i)).toBeInTheDocument();
  });

  it('handles help command execution locally', () => {
    renderComponent();

    const input = screen.getByLabelText('Terminal command');
    fireEvent.change(input, { target: { value: 'help' } });
    fireEvent.submit(input.closest('form')!);

    // Output should show available commands info
    expect(screen.getByText(/Available Commands:/i)).toBeInTheDocument();
    expect(screen.getByText(/gear \/ inventory/i)).toBeInTheDocument();
    expect(screen.getByText(/status \/ info/i)).toBeInTheDocument();
  });

  it('answers "ask dm" questions without taking a turn', async () => {
    vi.mocked(askDm).mockResolvedValueOnce({
      kind: 'answer',
      payload: { turnId: 1, revision: 0, question: 'can I break the door?', answer: 'It is heavy iron, but your shield could help.' },
    });
    renderComponent();

    const input = screen.getByLabelText('Terminal command');
    fireEvent.change(input, { target: { value: 'ask dm can I break the door?' } });
    fireEvent.submit(input.closest('form')!);

    expect(await screen.findByText('The DM says: It is heavy iron, but your shield could help.')).toBeInTheDocument();
    expect(vi.mocked(askDm)).toHaveBeenCalledWith('session-id-123', { question: 'can I break the door?', turnId: 1, revision: 0 });
    expect(mockPreviewAction).not.toHaveBeenCalled();
    expect(mockSubmitAction).not.toHaveBeenCalled();
  });

  it('submits a numbered choice selection', async () => {
    renderComponent();

    const input = screen.getByLabelText('Terminal command');
    fireEvent.change(input, { target: { value: '1' } });
    fireEvent.submit(input.closest('form')!);

    expect(screen.getByText(/Selected choice: Bash it down/i)).toBeInTheDocument();
    expect(mockSubmitChoice).toHaveBeenCalledWith(expect.objectContaining({ id: 41, label: 'Bash it down' }));
    expect(mockSubmitAction).not.toHaveBeenCalled();
  });

  it('handles custom actions with preview and confirm state', async () => {
    renderComponent();

    const input = screen.getByLabelText('Terminal command');
    fireEvent.change(input, { target: { value: 'cast a levitate spell' } });
    fireEvent.submit(input.closest('form')!);

    expect(screen.getByText(/Interpreting custom action: "cast a levitate spell"/i)).toBeInTheDocument();
    expect(mockPreviewAction).toHaveBeenCalledWith('cast a levitate spell');

    // Simulate the preview arriving: update mock return AND fire the callback
    // (mirrors what the real hook does - sets actionPreview state and calls onPreviewReady)
    const preview: FreeActionPreview = {
      originalAction: 'cast a levitate spell',
      interpretedAction: 'Use Levitation on the door',
      stat: 'magic',
      difficulty: 'easy',
      difficultyValue: 5,
      warnings: [],
    };
    vi.mocked(useCarSessionRuntime).mockImplementation(({ onPreviewReady }) => {
      capturedOnPreviewReady = onPreviewReady;
      return {
        session: mockSession,
        history: mockHistory,
        loading: false,
        actionError: null,
        connectionState: 'connected',
        prevEncounterStatus: 'none',
        submitAction: mockSubmitAction,
        submitChoice: mockSubmitChoice,
        previewAction: mockPreviewAction,
        actionPreview: preview,
        clearPreview: mockClearPreview,
        previewThinking: false,
        ideas: mockHistory[0].choices,
        requestIdeas: mockRequestIdeas,
      } as unknown as ReturnType<typeof useCarSessionRuntime>;
    });
    act(() => {
      capturedOnPreviewReady?.(preview);
    });

    // Confirm that interpretation results were outputted
    expect(screen.getByText(/Interpreted: Use Levitation on the door/i)).toBeInTheDocument();
    expect(screen.getByText(/Roll: magic \(difficulty: easy\)/i)).toBeInTheDocument();

    // Type confirm to send to backend
    const confirmInput = screen.getByLabelText('Terminal command');
    fireEvent.change(confirmInput, { target: { value: 'confirm' } });
    fireEvent.submit(confirmInput.closest('form')!);

    expect(screen.getByText(/Sending action to backend.../i)).toBeInTheDocument();
    expect(mockSubmitAction).toHaveBeenCalledWith(
      'Use Levitation on the door',
      'magic',
      'easy',
      5,
      null,
      null,
      null
    );
  });

  describe('auto-send', () => {
    const cleanPreview: FreeActionPreview = {
      originalAction: 'kick the door',
      interpretedAction: 'Kick the door open',
      stat: 'might',
      difficulty: 'normal',
      difficultyValue: 10,
      warnings: [],
    };

    const previewArrives = (preview: FreeActionPreview) => {
      vi.mocked(useCarSessionRuntime).mockImplementation(({ onPreviewReady }) => {
        capturedOnPreviewReady = onPreviewReady;
        return {
          session: mockSession,
          history: mockHistory,
          loading: false,
          actionError: null,
          connectionState: 'connected',
          prevEncounterStatus: 'none',
          submitAction: mockSubmitAction,
          submitChoice: mockSubmitChoice,
          previewAction: mockPreviewAction,
          actionPreview: preview,
          clearPreview: mockClearPreview,
          previewThinking: false,
          ideas: mockHistory[0].choices,
          requestIdeas: mockRequestIdeas,
        } as unknown as ReturnType<typeof useCarSessionRuntime>;
      });
      act(() => {
        capturedOnPreviewReady?.(preview);
      });
    };

    const typeCommand = (value: string) => {
      const input = screen.getByLabelText('Terminal command');
      fireEvent.change(input, { target: { value } });
      fireEvent.submit(input.closest('form')!);
    };

    it('sends a clean preview after the undo window', () => {
      vi.useFakeTimers();
      try {
        renderComponent();
        typeCommand('kick the door');
        previewArrives(cleanPreview);
        expect(screen.getByText(/Sending in 3s/i)).toBeInTheDocument();
        expect(mockSubmitAction).not.toHaveBeenCalled();
        act(() => {
          vi.advanceTimersByTime(3000);
        });
        expect(mockSubmitAction).toHaveBeenCalledWith('Kick the door open', 'might', 'normal', 10, null, null, null);
      } finally {
        vi.useRealTimers();
      }
    });

    it('cancel during the undo window stops the send', () => {
      vi.useFakeTimers();
      try {
        renderComponent();
        typeCommand('kick the door');
        previewArrives(cleanPreview);
        typeCommand('cancel');
        act(() => {
          vi.advanceTimersByTime(5000);
        });
        expect(screen.getByText(/Action cancelled/i)).toBeInTheDocument();
        expect(mockSubmitAction).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it('waits for confirm when the preview has warnings, or with confirm mode on', () => {
      vi.useFakeTimers();
      try {
        renderComponent();
        typeCommand('kick the door');
        previewArrives({ ...cleanPreview, warnings: ['The dragon is already asleep.'] });
        act(() => {
          vi.advanceTimersByTime(5000);
        });
        expect(mockSubmitAction).not.toHaveBeenCalled();
        typeCommand('cancel');

        typeCommand('confirm on');
        expect(screen.getByText(/Confirm mode on/i)).toBeInTheDocument();
        typeCommand('kick the door');
        previewArrives(cleanPreview);
        act(() => {
          vi.advanceTimersByTime(5000);
        });
        expect(mockSubmitAction).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
        window.localStorage.removeItem('dnd-fam-ftw:terminal:always-confirm');
      }
    });
  });

  it('handles Ctrl+L to clear screen', () => {
    renderComponent();

    expect(screen.getByText(/The heavy iron door blocks your path./i)).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'l', ctrlKey: true });

    expect(screen.queryByText(/The heavy iron door blocks your path./i)).not.toBeInTheDocument();
  });

  it('handles F3 button to clear screen', () => {
    renderComponent();

    expect(screen.getByText(/The heavy iron door blocks your path./i)).toBeInTheDocument();

    const clearButton = screen.getByRole('button', { name: '[F3] Clear Screen' });
    fireEvent.click(clearButton);

    expect(screen.queryByText(/The heavy iron door blocks your path./i)).not.toBeInTheDocument();
  });

  describe('with an open DM question', () => {
    const mockClearClarification = vi.fn();
    let capturedOnClarification: ((question: string) => void) | undefined;

    beforeEach(() => {
      vi.mocked(useCarSessionRuntime).mockImplementation(({ onClarification }) => {
        capturedOnClarification = onClarification;
        return {
          session: mockSession,
          history: mockHistory,
          loading: false,
          actionError: null,
          connectionState: 'connected',
          prevEncounterStatus: 'none',
          submitAction: mockSubmitAction,
          submitChoice: mockSubmitChoice,
          previewAction: mockPreviewAction,
          actionPreview: null,
          clearPreview: mockClearPreview,
          previewThinking: false,
          ideas: mockHistory[0].choices,
          requestIdeas: mockRequestIdeas,
          clarification: { originalDraft: 'I play the piano', exchange: [], question: 'Is "piano" your answer to the riddle?' },
          clearClarification: mockClearClarification,
        } as unknown as ReturnType<typeof useCarSessionRuntime>;
      });
    });

    const type = (value: string) => {
      const input = screen.getByLabelText('Terminal command');
      fireEvent.change(input, { target: { value } });
      fireEvent.submit(input.closest('form')!);
    };

    it('prints the question as a transcript entry', () => {
      renderComponent();
      act(() => capturedOnClarification?.('Is "piano" your answer to the riddle?'));
      expect(screen.getByText('The DM asks: Is "piano" your answer to the riddle?')).toBeInTheDocument();
    });

    it('sends "yes" and numbers as the answer, never as a confirmation or a choice', async () => {
      renderComponent();
      type('yes');
      await waitFor(() => expect(mockPreviewAction).toHaveBeenCalledWith('yes'));
      type('1');
      await waitFor(() => expect(mockPreviewAction).toHaveBeenCalledWith('1'));
      expect(mockSubmitAction).not.toHaveBeenCalled();
      expect(mockSubmitChoice).not.toHaveBeenCalled();
    });

    it('drops the question on "cancel" and keeps info commands working', async () => {
      renderComponent();
      type('cancel');
      expect(mockClearClarification).toHaveBeenCalled();
      type('help');
      expect(screen.getByText(/Available Commands:/i)).toBeInTheDocument();
      expect(mockPreviewAction).not.toHaveBeenCalled();
    });
  });

  describe('with no ideas yet', () => {
    beforeEach(() => {
      vi.mocked(useCarSessionRuntime).mockImplementation(() => ({
        session: mockSession,
        history: [{ ...mockHistory[0], choices: [] }],
        loading: false,
        actionError: null,
        connectionState: 'connected',
        prevEncounterStatus: 'none',
        submitAction: mockSubmitAction,
        submitChoice: mockSubmitChoice,
        previewAction: mockPreviewAction,
        actionPreview: null,
        clearPreview: mockClearPreview,
        previewThinking: false,
        ideas: [],
        requestIdeas: mockRequestIdeas,
      } as unknown as ReturnType<typeof useCarSessionRuntime>));
    });

    const type = (value: string) => {
      const input = screen.getByLabelText('Terminal command');
      fireEvent.change(input, { target: { value } });
      fireEvent.submit(input.closest('form')!);
    };

    it('invites a typed action instead of listing options', () => {
      renderComponent();
      expect(screen.getByText(/What do you try\? Type it in your own words/)).toBeInTheDocument();
    });

    it('asks the DM for ideas and prints them numbered', async () => {
      mockRequestIdeas.mockResolvedValueOnce({ kind: 'ideas', payload: { turnId: 1, revision: 1, characterId: 'char-1', degraded: false, choices: [{ id: 5, label: 'Climb the chimney', stat: 'might', difficulty: 'normal' }] } });
      renderComponent();
      type('ideas');
      expect(await screen.findByText(/1\. Climb the chimney/)).toBeInTheDocument();
    });

    it('explains that numbers need ideas first, without submitting', () => {
      renderComponent();
      type('1');
      expect(screen.getByText(/There are no ideas yet/)).toBeInTheDocument();
      expect(mockSubmitChoice).not.toHaveBeenCalled();
    });
  });
});

