import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCarConductor } from './useCarConductor';
import { useSpeechRecognition } from '../../stt/useSpeechRecognition';
import { narrationTtsService } from '../../tts/narrationTtsService';
import type { FreeActionPreview, Session, TurnResult } from '../../types';
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
  const mockConfirmPreview = vi.fn().mockResolvedValue({ ok: true });
  const mockSubmitChoice = vi.fn().mockResolvedValue({ ok: true });
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
        confirmPreview: mockConfirmPreview,
        submitChoice: mockSubmitChoice,
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
        confirmPreview: mockConfirmPreview,
        submitChoice: mockSubmitChoice,
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

  describe('ideas that arrive after the turn was read (Suggest ideas each turn)', () => {
    const withoutIdeas: TurnResult[] = [{ ...mockHistory[0], choices: [] }];
    const spokenTexts = () => vi.mocked(narrationTtsService.speakNarration).mock.calls.map(call => call[0].text);
    const settle = () => act(async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
    });

    const renderConductor = (autoIdeas: boolean) => {
      vi.mocked(useSpeechRecognition).mockReturnValue({
        state: { status: 'listening', transcript: '' },
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
      return renderHook(({ history }: { history: TurnResult[] }) =>
        useCarConductor({
          session: { ...mockSession, autoIdeas },
          history,
          loading: false,
          connectionState: 'connected',
          prevEncounterStatus: 'none',
          actionPreview: null,
          previewThinking: false,
          confirmPreview: mockConfirmPreview,
          submitChoice: mockSubmitChoice,
          previewAction: mockPreviewAction,
          clearPreview: mockClearPreview,
          ttsSettings: mockTtsSettings,
          hasTts: true,
        }), { initialProps: { history: withoutIdeas } });
    };

    it('reads them once in the next quiet moment, with the microphone stopped first', async () => {
      const { rerender } = renderConductor(true);
      await settle();
      expect(spokenTexts().some(text => text.includes('Light a torch'))).toBe(false);

      rerender({ history: mockHistory });
      await settle();

      expect(mockCancelSpeechRec).toHaveBeenCalled();
      expect(spokenTexts().filter(text => text.includes('Light a torch'))).toHaveLength(1);

      rerender({ history: [...mockHistory] });
      await settle();
      expect(spokenTexts().filter(text => text.includes('Light a torch'))).toHaveLength(1);
    });

    it('waits for "ideas" when the realm setting is off', async () => {
      const { rerender } = renderConductor(false);
      await settle();
      rerender({ history: mockHistory });
      await settle();

      expect(spokenTexts().some(text => text.includes('Light a torch'))).toBe(false);
    });
  });
  describe('confirming a spoken preview', () => {
    const preview: FreeActionPreview = {
      previewId: 'p-car',
      originalAction: 'climb the wall',
      interpretedAction: 'Hagar climbs the slick wall',
      stat: 'might',
      difficulty: 'normal',
      warnings: [],
    };
    const settle = () => act(async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
    });
    const say = async (text: string) => {
      const { onConfirmTranscript } = vi.mocked(useSpeechRecognition).mock.calls.at(-1)![0];
      await act(async () => {
        await onConfirmTranscript(text);
      });
    };

    const renderConductor = () => renderHook(({ actionPreview }: { actionPreview: FreeActionPreview | null }) =>
      useCarConductor({
        session: mockSession,
        history: mockHistory,
        loading: false,
        connectionState: 'connected',
        prevEncounterStatus: 'none',
        actionPreview,
        previewThinking: false,
        confirmPreview: mockConfirmPreview,
        submitChoice: mockSubmitChoice,
        previewAction: mockPreviewAction,
        clearPreview: mockClearPreview,
        ttsSettings: mockTtsSettings,
        hasTts: true,
      }), { initialProps: { actionPreview: null as FreeActionPreview | null } });

    it('sends the preview object it read out, by its id', async () => {
      const { rerender } = renderConductor();
      await say('climb the wall');
      expect(mockPreviewAction).toHaveBeenCalledWith('climb the wall');
      rerender({ actionPreview: preview });
      await settle();

      await say('confirm');

      expect(mockConfirmPreview).toHaveBeenCalledWith(preview);
      expect(mockClearPreview).toHaveBeenCalled();
    });

    // Behaviour change (plan 6 B2). Before: a refused submission still moved the
    // conductor to processing. After: it says why and stays out of processing.
    it('says why a confirm was refused and does not wait for a turn', async () => {
      mockConfirmPreview.mockResolvedValueOnce({ ok: false, error: 'usage_limit', message: 'The realm is out of stories for today.' });
      const { rerender, result } = renderConductor();
      await say('climb the wall');
      rerender({ actionPreview: preview });
      await settle();

      await say('confirm');

      expect(result.current.conductorState).not.toBe('processing');
      expect(result.current.transcriptLog).toContain('System: The realm is out of stories for today.');
      expect(vi.mocked(narrationTtsService.speakNarration).mock.calls.some(call => call[0].text === 'The realm is out of stories for today.')).toBe(true);
    });

    it('keeps waiting for a confirm when the preview was asked for again', async () => {
      mockConfirmPreview.mockResolvedValueOnce({ ok: false, error: 'preview_refreshed', message: 'The story moved on.' });
      const { rerender, result } = renderConductor();
      await say('climb the wall');
      rerender({ actionPreview: preview });
      await settle();

      await say('confirm');

      expect(mockClearPreview).not.toHaveBeenCalled();
      expect(result.current.conductorState).not.toBe('processing');
      expect(result.current.transcriptLog).toContain('System: The story moved on. Previewed again.');
    });
  });
});
