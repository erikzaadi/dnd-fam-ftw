import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCarConductor } from './useCarConductor';
import { useSpeechRecognition } from '../../stt/useSpeechRecognition';
import { narrationTtsService } from '../../tts/narrationTtsService';
import type { Session, TurnResult } from '../../types';
import type { TtsSettings } from '../../tts/ttsTypes';

vi.mock('../../stt/useSpeechRecognition', () => ({
  useSpeechRecognition: vi.fn(),
}));

vi.mock('../../tts/narrationTtsService', () => ({
  narrationTtsService: {
    speakNarration: vi.fn().mockResolvedValue(undefined),
    stopNarration: vi.fn(),
    isNarrationSpeaking: vi.fn().mockReturnValue(false),
  },
}));

describe('useCarConductor', () => {
  const mockSubmitAction = vi.fn().mockResolvedValue(undefined);
  const mockPreviewAction = vi.fn().mockResolvedValue(undefined);
  const mockClearPreview = vi.fn();

  const mockSession: Session = {
    id: '1',
    scene: 'Cave',
    turn: 1,
    displayName: 'Test Session',
    savingsMode: false,
    interventionState: { rescuesUsed: 0 },
    activeCharacterId: 'char-1',
    party: [
      {
        id: 'char-1',
        name: 'Hagar',
        class: 'Barbarian',
        species: 'Human',
        quirk: 'Angry',
        hp: 10,
        max_hp: 10,
        status: 'active',
        stats: { might: 3, magic: 0, mischief: 1 },
        inventory: [],
      },
    ],
  };

  const mockHistory: TurnResult[] = [
    {
      id: 1,
      narration: 'You enter a dark cave.',
      choices: [{ label: 'Light a torch', difficulty: 'easy', stat: 'magic' }],
      imagePrompt: null,
      imageSuggested: false,
    },
  ];

  const mockTtsSettings: TtsSettings = {
    enabled: true,
    autoSpeakNarration: true,
    provider: 'browser',
    volume: 1,
    rate: 1,
    pitch: 1,
    preferredVoiceURI: null,
    preferredVoiceName: null,
    preferredLang: null,
    preferredStyle: 'neutral',
    browserGenderHint: 'any',
    openAiVoice: 'cedar',
  };

  const mockStartListening = vi.fn();
  const mockCancelSpeechRec = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useSpeechRecognition).mockReturnValue({
      state: { status: 'idle' },
      startListening: mockStartListening,
      stopListening: vi.fn(),
      confirmTranscript: vi.fn(),
      retryListening: vi.fn(),
      cancel: mockCancelSpeechRec,
      reset: vi.fn(),
      isSupported: true,
      transcript: '',
      errorMessage: null,
    });
  });

  it('initializes in idle state', () => {
    const { result } = renderHook(() =>
      useCarConductor({
        session: mockSession,
        history: mockHistory,
        loading: false,
        connectionState: 'connected',
        prevEncounterStatus: 'none',
        actionPreview: null,
        previewThinking: false,
        submitAction: mockSubmitAction,
        previewAction: mockPreviewAction,
        clearPreview: mockClearPreview,
        ttsSettings: mockTtsSettings,
        hasTts: true,
      })
    );

    expect(result.current.conductorState).toBe('idle');
    expect(result.current.isPaused).toBe(false);
  });

  it('pauses and resumes correctly', () => {
    const { result } = renderHook(() =>
      useCarConductor({
        session: mockSession,
        history: mockHistory,
        loading: false,
        connectionState: 'connected',
        prevEncounterStatus: 'none',
        actionPreview: null,
        previewThinking: false,
        submitAction: mockSubmitAction,
        previewAction: mockPreviewAction,
        clearPreview: mockClearPreview,
        ttsSettings: mockTtsSettings,
        hasTts: true,
      })
    );

    act(() => {
      result.current.pauseConductor();
    });

    expect(result.current.isPaused).toBe(true);
    expect(narrationTtsService.stopNarration).toHaveBeenCalled();

    act(() => {
      result.current.resumeConductor();
    });

    expect(result.current.isPaused).toBe(false);
  });
});
