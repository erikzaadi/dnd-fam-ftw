import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { TerminalMode } from './TerminalMode';
import { useCarSessionRuntime } from '../session/car/useCarSessionRuntime';
import type { Session, TurnResult, FreeActionPreview } from '../types';

vi.mock('../session/car/useCarSessionRuntime', () => ({
  useCarSessionRuntime: vi.fn(),
}));

describe('TerminalMode', () => {
  const mockSubmitAction = vi.fn().mockResolvedValue(undefined);
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
        { label: 'Bash it down', stat: 'might', difficulty: 'hard' },
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
        previewAction: mockPreviewAction,
        actionPreview: null,
        clearPreview: mockClearPreview,
        previewThinking: false,
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

  it('submits a numbered choice selection', async () => {
    renderComponent();

    const input = screen.getByLabelText('Terminal command');
    fireEvent.change(input, { target: { value: '1' } });
    fireEvent.submit(input.closest('form')!);

    expect(screen.getByText(/Selected choice: Bash it down/i)).toBeInTheDocument();
    expect(mockSubmitAction).toHaveBeenCalledWith('Bash it down', 'might', 'hard', null);
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
        previewAction: mockPreviewAction,
        actionPreview: preview,
        clearPreview: mockClearPreview,
        previewThinking: false,
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
});
