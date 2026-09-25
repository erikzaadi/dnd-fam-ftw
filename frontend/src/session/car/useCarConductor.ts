import { useCallback, useEffect, useRef, useState } from 'react';
import type { Choice, Session, TurnResult, FreeActionPreview } from '../../types';
import type { TtsSettings } from '../../tts/ttsTypes';
import { parseSpeechIntent, QUESTION_PASSTHROUGH_INTENTS } from '../../stt/speechIntent';
import { isDropQuestionCommand, type ClarificationThread } from '../../lib/previewAction';
import { useSpeechRecognition } from '../../stt/useSpeechRecognition';
import { narrationTtsService } from '../../tts/narrationTtsService';
import {
  buildRollResultSegment,
  buildNarrationSegment,
  buildEncounterBoundarySegment,
  buildActiveCharacterSegment,
  buildChoicesSegment,
  buildEncounterSegment,
  buildGearSegment,
  buildStatusSegment,
  buildPartySegment,
  buildLocationSegment,
  CHOOSE_ACTION_PROMPT,
  CONFIRM_ACTION_PROMPT,
  HELP_CACHE_KEY,
  HELP_TEXT,
  OPEN_ACTION_CACHE_KEY,
  OPEN_ACTION_PROMPT,
  ORIENTATION_CACHE_KEY,
  ORIENTATION_PROMPT,
} from './carSpeechSegment';
import { currentIdeas, type IdeasRequestResult } from '../../lib/ideas';
import { askDm } from '../../lib/askDm';

// With ideas on the table: read them and ask for a number or a custom action.
// Without: an open question, never a list.
const actionPromptSegment = (hasIdeas: boolean): SpokenSegment => (hasIdeas
  ? { type: 'prompt', text: CHOOSE_ACTION_PROMPT, cacheKey: 'car:v1:prompt:choose-action' }
  : { type: 'prompt', text: OPEN_ACTION_PROMPT, cacheKey: OPEN_ACTION_CACHE_KEY });

export type ConductorState =
  | 'idle'
  | 'speaking'
  | 'listening'
  | 'processing'
  | 'confirming'
  | 'submitting'
  | 'error'
  | 'reconnecting';

export type SpokenSegment = {
  type: 'roll' | 'narration' | 'choices' | 'prompt' | 'preview' | 'other';
  text: string;
  cacheKey?: string;
};

interface UseCarConductorProps {
  session: Session | null;
  history: TurnResult[];
  loading: boolean;
  connectionState: 'connected' | 'reconnecting' | 'disconnected';
  prevEncounterStatus: string;
  actionPreview: FreeActionPreview | null;
  previewThinking: boolean;
  submitAction: (
    action: string,
    statUsed?: string,
    difficulty?: string,
    difficultyValue?: number | null,
    ownerCharId?: string | null,
    itemId?: string | null,
    targetCharId?: string | null,
    actionIntent?: string
  ) => Promise<void>;
  // Selects a suggestion explicitly by its stable id.
  submitChoice: (choice: Choice) => Promise<void>;
  previewAction: (actionText: string) => Promise<void>;
  clearPreview: () => void;
  // An open DM question about the draft: the next utterance answers it.
  clarification?: ClarificationThread | null;
  clearClarification?: () => void;
  // Asks the server for ideas for the latest turn ("ideas" / "options").
  requestIdeas?: () => Promise<IdeasRequestResult>;
  ttsSettings: TtsSettings;
  hasTts: boolean;
  // Session management. Resolve to an error message, or null on success.
  wrapUpAdventure?: () => Promise<string | null>;
  endAdventure?: () => Promise<string | null>;
}

export function useCarConductor({
  session,
  history,
  loading,
  connectionState,
  prevEncounterStatus,
  actionPreview,
  previewThinking: _previewThinking,
  submitAction,
  submitChoice,
  previewAction,
  clearPreview,
  clarification = null,
  clearClarification,
  requestIdeas,
  ttsSettings,
  hasTts,
  wrapUpAdventure,
  endAdventure,
}: UseCarConductorProps) {
  const [conductorState, setConductorState] = useState<ConductorState>('idle');
  const [isPaused, setIsPaused] = useState(false);
  const [transcriptLog, setTranscriptLog] = useState<string[]>([]);
  const [currentSegmentType, setCurrentSegmentType] = useState<SpokenSegment['type'] | null>(null);

  const isPausedRef = useRef(false);
  const currentSequenceRef = useRef<SpokenSegment[]>([]);
  const currentSegmentIdxRef = useRef<number>(0);
  const lastSpokenTurnIdRef = useRef<number | undefined>(undefined);
  const spokenRollTurnIdRef = useRef<number | undefined>(undefined);
  const confirmingActionRef = useRef<string | null>(null);
  const retryCountRef = useRef(0);
  const listeningTimeoutRef = useRef<number | undefined>(undefined);
  const spokenReconnectingRef = useRef(false);
  const lastSttStatusRef = useRef<string>('idle');
  const hasSpokenOrientationRef = useRef(false);
  // Turn whose ideas were already read out, so they are read at most once.
  const ideasReadTurnIdRef = useRef<number | undefined>(undefined);

  const startListeningRef = useRef<() => Promise<void> | void>(() => {});
  const cancelSpeechRecRef = useRef<() => void>(() => {});

  const addToTranscriptLog = useCallback((message: string) => {
    setTranscriptLog(prev => [...prev, message]);
  }, []);

  const cancelListening = useCallback(() => {
    if (listeningTimeoutRef.current) {
      window.clearTimeout(listeningTimeoutRef.current);
      listeningTimeoutRef.current = undefined;
    }
  }, []);

  const pauseConductor = useCallback(() => {
    isPausedRef.current = true;
    setIsPaused(true);
    setConductorState('idle');
    narrationTtsService.stopNarration();
    cancelListening();
    addToTranscriptLog('System: Voice mode paused.');
  }, [addToTranscriptLog, cancelListening]);

  const startListeningFlow = useCallback(() => {
    if (isPausedRef.current) {
      return;
    }

    setConductorState('listening');
    narrationTtsService.stopNarration();

    if (listeningTimeoutRef.current) {
      window.clearTimeout(listeningTimeoutRef.current);
    }

    listeningTimeoutRef.current = window.setTimeout(() => {
      if (isPausedRef.current) {
        return;
      }
      if (narrationTtsService.isNarrationSpeaking()) {
        return;
      }
      void startListeningRef.current();
    }, 250);
  }, []);

  const speakTempText = useCallback(async (text: string, cacheKey?: string) => {
    if (isPausedRef.current) {
      return;
    }
    setConductorState('speaking');
    narrationTtsService.stopNarration();
    cancelListening();

    try {
      await narrationTtsService.speakNarration({
        text,
        settings: ttsSettings,
        hasTts,
        cacheKey,
        carMode: true,
      });
    } catch (err) {
      console.error('[CarConductor] speakTempText failed:', err);
    }
    startListeningFlow();
  }, [ttsSettings, hasTts, cancelListening, startListeningFlow]);

  const speakInfo = useCallback(async (text: string, cacheKey?: string) => {
    await speakTempText(text, cacheKey);
  }, [speakTempText]);

  const speakAlert = useCallback(async (text: string) => {
    if (isPausedRef.current) {
      return;
    }
    setConductorState('speaking');
    narrationTtsService.stopNarration();
    cancelListening();

    try {
      await narrationTtsService.speakNarration({
        text,
        settings: ttsSettings,
        hasTts,
        carMode: true,
      });
    } catch (err) {
      console.error('[CarConductor] speakAlert failed:', err);
    }
  }, [ttsSettings, hasTts, cancelListening]);

  const speakRollNarration = useCallback(async (text: string) => {
    if (isPausedRef.current) {
      return;
    }
    setConductorState('speaking');
    narrationTtsService.stopNarration();
    cancelListening();

    try {
      await narrationTtsService.speakNarration({
        text,
        settings: ttsSettings,
        hasTts,
        carMode: true,
      });
      // Mark that we spoke a roll result for the currently incoming turn
      // Note: we'll match it with the NEXT turnId that appears in history
      spokenRollTurnIdRef.current = (history[history.length - 1]?.id ?? 0) + 1;
    } catch (err) {
      console.error('[CarConductor] speakRollNarration failed:', err);
    }
    setConductorState('processing');
  }, [ttsSettings, hasTts, cancelListening, history]);

  const playSequence = useCallback(async (seq: SpokenSegment[], startIndex = 0) => {
    if (isPausedRef.current) {
      return;
    }

    setConductorState('speaking');
    narrationTtsService.stopNarration();
    cancelListening();
    currentSequenceRef.current = seq;

    for (let i = startIndex; i < seq.length; i++) {
      if (isPausedRef.current) {
        currentSegmentIdxRef.current = i;
        return;
      }
      currentSegmentIdxRef.current = i;
      setCurrentSegmentType(seq[i].type);

      try {
        await narrationTtsService.speakNarration({
          text: seq[i].text,
          settings: ttsSettings,
          hasTts,
          cacheKey: seq[i].cacheKey,
          mainNarration: seq[i].type === 'narration',
          carMode: true,
        });
      } catch (err) {
        console.error('[CarConductor] TTS sequence play failed:', err);
      }
    }

    if (isPausedRef.current) {
      return;
    }
    startListeningFlow();
  }, [ttsSettings, hasTts, startListeningFlow, cancelListening]);

  // Ideas current for the latest turn; stale ones are never read out or picked.
  const latestIdeas = useCallback(
    () => currentIdeas(history[history.length - 1], { revision: session?.revision, activeCharacterId: session?.activeCharacterId }),
    [history, session?.revision, session?.activeCharacterId],
  );

  const speakOptionsAndPrompt = useCallback(() => {
    const ideas = latestIdeas();
    const choicesSeg = buildChoicesSegment(ideas, session);
    if (ideas.length > 0) {
      ideasReadTurnIdRef.current = history[history.length - 1]?.id;
    }

    const seq: SpokenSegment[] = [];
    if (choicesSeg) {
      seq.push({ type: 'choices', text: choicesSeg });
    }
    seq.push(actionPromptSegment(ideas.length > 0));

    void playSequence(seq);
  }, [history, latestIdeas, session, playSequence]);

  // "ideas" / "options": read current ideas, or ask the DM for some first.
  const speakIdeas = useCallback(async () => {
    if (latestIdeas().length > 0) {
      speakOptionsAndPrompt();
      return;
    }
    if (!requestIdeas) {
      await speakTempText('What do you try? Say it in your own words.');
      return;
    }
    addToTranscriptLog('System: Asking the DM for ideas...');
    const result = await requestIdeas();
    if (result.kind === 'error') {
      addToTranscriptLog(`System: ${result.message}`);
      await speakTempText(`${result.message} Or just say what you try.`);
      return;
    }
    const seq: SpokenSegment[] = [];
    const choicesSeg = buildChoicesSegment(result.payload.choices, session);
    if (choicesSeg) {
      seq.push({ type: 'choices', text: choicesSeg });
    }
    seq.push(actionPromptSegment(result.payload.choices.length > 0));
    void playSequence(seq);
  }, [addToTranscriptLog, latestIdeas, playSequence, requestIdeas, session, speakOptionsAndPrompt, speakTempText]);

  const speakFullStorySequence = useCallback(() => {
    const latestTurn = history[history.length - 1];
    if (!latestTurn) {
      const seq: SpokenSegment[] = [
        { type: 'prompt', text: CHOOSE_ACTION_PROMPT, cacheKey: 'car:v1:prompt:choose-action' },
      ];
      void playSequence(seq);
      return;
    }

    const seq: SpokenSegment[] = [];

    // Only add roll segment if we didn't already speak it mid-turn
    if (spokenRollTurnIdRef.current !== latestTurn.id) {
      const rollSeg = buildRollResultSegment(latestTurn);
      if (rollSeg) {
        seq.push({ type: 'roll', text: rollSeg });
      }
    }

    const currentEncounterStatus = session?.encounterState?.status || 'none';
    const boundarySeg = buildEncounterBoundarySegment(
      prevEncounterStatus,
      currentEncounterStatus,
      session?.encounterState?.name,
      session?.encounterState?.status !== 'active' ? latestTurn.narration : undefined
    );
    if (boundarySeg) {
      seq.push({ type: 'other', text: boundarySeg });
    }

    const narrSeg = buildNarrationSegment(latestTurn);
    if (narrSeg) {
      seq.push({ type: 'narration', text: narrSeg });
    }

    if (session) {
      const activeCharSeg = buildActiveCharacterSegment(session);
      if (activeCharSeg) {
        seq.push({ type: 'other', text: activeCharSeg });
      }
    }

    const ideas = latestIdeas();
    const choicesSeg = buildChoicesSegment(ideas, session);
    if (choicesSeg) {
      seq.push({ type: 'choices', text: choicesSeg });
      ideasReadTurnIdRef.current = latestTurn.id;
    }

    const activeChar = session?.party.find(c => c.id === session.activeCharacterId);
    const chimeMarker = activeChar ? `${activeChar.name}'s move.` : 'Your move.';
    const chimeKey = activeChar ? `car:v1:chime:${activeChar.id}` : 'car:v1:chime:your-move';

    seq.push({ type: 'other', text: chimeMarker, cacheKey: chimeKey });
    if (!hasSpokenOrientationRef.current) {
      hasSpokenOrientationRef.current = true;
      seq.push({ type: 'prompt', text: ORIENTATION_PROMPT, cacheKey: ORIENTATION_CACHE_KEY });
    }
    seq.push(actionPromptSegment(ideas.length > 0));

    void playSequence(seq);
  }, [history, latestIdeas, session, prevEncounterStatus, playSequence]);

  const handleSpeechTranscript = async (transcript: string) => {
    if (isPausedRef.current) {
      return;
    }
    setConductorState('processing');
    const intent = parseSpeechIntent(transcript);

    addToTranscriptLog(`You: "${transcript}"`);

    // An open DM question: "yes" and "no" are answers here, not confirm/cancel.
    if (clarification && !QUESTION_PASSTHROUGH_INTENTS.has(intent.type)) {
      if (isDropQuestionCommand(transcript)) {
        addToTranscriptLog('Interpreted: Start Over');
        clearClarification?.();
        confirmingActionRef.current = null;
        await speakTempText('Okay, starting over. What do you do?');
      } else if (intent.type === 'repeat' || intent.type === 'options') {
        await speakTempText(`The DM asks: ${clarification.question}`);
      } else {
        const reply = transcript.trim();
        addToTranscriptLog(`Interpreted answer: ${reply}`);
        confirmingActionRef.current = reply;
        await previewAction(reply);
      }
      return;
    }

    // "Ask the DM ...": a spoken answer, then back to listening. Nothing changes.
    if (intent.type === 'ask') {
      const askTurnId = history[history.length - 1]?.id;
      if (!session || askTurnId === undefined) {
        await speakTempText('The story has not started yet.');
        return;
      }
      addToTranscriptLog(`Interpreted: Ask the DM: ${intent.question}`);
      setConductorState('processing');
      const result = await askDm(session.id, { question: intent.question, turnId: askTurnId, revision: session.revision ?? 0 });
      if (result.kind === 'answer') {
        addToTranscriptLog(`DM: ${result.payload.answer}`);
        await speakTempText(result.payload.answer);
      } else {
        addToTranscriptLog(`System: ${result.message}`);
        await speakTempText(result.message);
      }
      return;
    }

    if (intent.type === 'choice') {
      if (confirmingActionRef.current) {
        addToTranscriptLog('System: Waiting for confirmation.');
        await speakTempText('We are waiting for confirmation. Say confirm to submit or cancel to go back.');
        return;
      }

      const choice = latestIdeas()[intent.index];
      if (choice) {
        addToTranscriptLog(`Interpreted: Option ${intent.index + 1}: ${choice.label}`);
        setConductorState('submitting');
        await speakAlert('Action sent.');
        try {
          await submitChoice(choice);
          setConductorState('processing');
        } catch {
          addToTranscriptLog('System: Action submission failed.');
          setConductorState('error');
          await speakTempText('Something went wrong. Say repeat to try again.');
        }
      } else {
        addToTranscriptLog(`System: Option ${intent.index + 1} is invalid.`);
        await speakTempText(latestIdeas().length > 0
          ? `Option ${intent.index + 1} is not valid. Say ideas to hear them again.`
          : 'There are no ideas yet. Say ideas to get some, or say what you try.');
      }
      return;
    }

    if (intent.type === 'confirm') {
      if (confirmingActionRef.current) {
        const preview = actionPreview;
        if (preview) {
          addToTranscriptLog('Interpreted: Confirm Action');
          setConductorState('submitting');
          await speakAlert('Action sent.');
          confirmingActionRef.current = null;
          try {
            await submitAction(
              preview.interpretedAction,
              preview.stat,
              preview.difficulty,
              preview.difficultyValue ?? null,
              null,
              null,
              null
            );
            clearPreview();
            setConductorState('processing');
          } catch {
            addToTranscriptLog('System: Action submission failed.');
            setConductorState('error');
            await speakTempText('Something went wrong. Say repeat to try again.');
          }
        }
      } else {
        await speakTempText('Nothing to confirm. What do you do?');
      }
      return;
    }

    if (intent.type === 'cancel') {
      if (confirmingActionRef.current) {
        addToTranscriptLog('Interpreted: Cancel Preview');
        confirmingActionRef.current = null;
        clearPreview();
        speakOptionsAndPrompt();
      } else {
        await speakTempText('Nothing to cancel. What do you do?');
      }
      return;
    }

    if (intent.type === 'retry') {
      if (confirmingActionRef.current) {
        addToTranscriptLog('Interpreted: Try Again');
        confirmingActionRef.current = null;
        clearPreview();
        await speakTempText('What do you do instead?');
      } else {
        await speakTempText('Nothing to retry. What do you do?');
      }
      return;
    }

    if (intent.type === 'wrap-up') {
      const error = wrapUpAdventure ? await wrapUpAdventure() : 'Wrapping up is not available here.';
      await speakTempText(error ?? 'Got it. The story will head for its finale soon.');
      return;
    }

    if (intent.type === 'end-here') {
      addToTranscriptLog('Interpreted: End the adventure here');
      const error = endAdventure ? await endAdventure() : 'Ending is not available here.';
      await speakTempText(error ?? 'Ending the adventure here. The storyteller is writing the epilogue.');
      return;
    }

    if (intent.type === 'help') {
      await speakInfo(HELP_TEXT, HELP_CACHE_KEY);
      return;
    }

    if (intent.type === 'status') {
      if (session) {
        const expected = confirmingActionRef.current ? 'confirmation' : 'action selection';
        const statusText = buildStatusSegment(session, expected);
        await speakInfo(statusText);
      }
      return;
    }

    if (intent.type === 'party') {
      if (session) {
        const partyText = buildPartySegment(session);
        await speakInfo(partyText);
      }
      return;
    }

    if (intent.type === 'gear') {
      if (session) {
        const gearText = buildGearSegment(session);
        await speakInfo(gearText);
      }
      return;
    }

    if (intent.type === 'encounter') {
      if (session) {
        const encText = buildEncounterSegment(session);
        await speakInfo(encText);
      }
      return;
    }

    if (intent.type === 'where-are-we') {
      if (session) {
        const latestTurn = history[history.length - 1];
        const locText = buildLocationSegment(session, latestTurn);
        await speakInfo(locText);
      }
      return;
    }

    if (intent.type === 'repeat') {
      speakOptionsAndPrompt();
      return;
    }

    if (intent.type === 'story-repeat') {
      speakFullStorySequence();
      return;
    }

    if (intent.type === 'options') {
      await speakIdeas();
      return;
    }

    if (intent.type === 'pause') {
      pauseConductor();
      return;
    }

    if (intent.type === 'resume') {
      resumeConductor();
      return;
    }

    if (intent.type === 'custom') {
      if (confirmingActionRef.current) {
        await speakTempText('We are waiting for confirmation. Say confirm to submit or cancel to go back.');
        return;
      }
      addToTranscriptLog(`Interpreted custom action: ${intent.text}`);
      confirmingActionRef.current = intent.text;
      await previewAction(intent.text);
    }
  };

  const {
    state: sttState,
    startListening,
    cancel: cancelSpeechRec,
    confirmTranscript,
    errorMessage: sttError,
  } = useSpeechRecognition({
    onConfirmTranscript: handleSpeechTranscript,
  });

  useEffect(() => {
    startListeningRef.current = startListening;
    cancelSpeechRecRef.current = cancelSpeechRec;
  }, [startListening, cancelSpeechRec]);

  // Realm setting "Suggest ideas each turn": ideas can land after the turn was read out.
  // They are read once, in the next quiet moment while listening (nothing heard yet),
  // never over a preview, an open DM question, or a player mid-sentence.
  const latestTurnId = history[history.length - 1]?.id;
  const hasCurrentIdeas = latestIdeas().length > 0;
  const listeningGap = sttState.status === 'listening' && sttState.transcript === '';
  const autoIdeas = !!session?.autoIdeas;
  useEffect(() => {
    if (!autoIdeas || !hasCurrentIdeas || !listeningGap || isPaused || loading || actionPreview || clarification || confirmingActionRef.current) {
      return;
    }
    if (latestTurnId === undefined || lastSpokenTurnIdRef.current !== latestTurnId || ideasReadTurnIdRef.current === latestTurnId) {
      return;
    }
    ideasReadTurnIdRef.current = latestTurnId;
    // Stop the microphone first so it does not hear the DM.
    cancelSpeechRec();
    setTimeout(() => {
      addToTranscriptLog('System: The DM has ideas.');
      speakOptionsAndPrompt();
    }, 0);
  }, [autoIdeas, hasCurrentIdeas, listeningGap, isPaused, loading, actionPreview, clarification, latestTurnId, cancelSpeechRec, addToTranscriptLog, speakOptionsAndPrompt]);

  const resumeConductor = useCallback(() => {
    isPausedRef.current = false;
    setIsPaused(false);
    addToTranscriptLog('System: Voice mode resumed.');
    void playSequence(currentSequenceRef.current, currentSegmentIdxRef.current);
  }, [playSequence, addToTranscriptLog]);

  useEffect(() => {
    if (sttState.status === 'confirming') {
      void confirmTranscript();
    }
  }, [sttState.status, confirmTranscript]);

  useEffect(() => {
    if (sttState.status === 'error' && lastSttStatusRef.current !== 'error') {
      if (retryCountRef.current < 1) {
        retryCountRef.current += 1;
        setTimeout(() => {
          addToTranscriptLog("System: Didn't hear anything. Retrying...");
          void speakTempText("I didn't hear anything. Please try again.", 'car:v1:error:retry-prompt');
        }, 0);
      } else {
        setTimeout(() => {
          addToTranscriptLog('System: Listening timed out. Idle.');
          setConductorState('idle');
        }, 0);
      }
    }
    if (sttState.status === 'confirming' || sttState.status === 'processing') {
      retryCountRef.current = 0;
    }
    lastSttStatusRef.current = sttState.status;
  }, [sttState.status, speakTempText, addToTranscriptLog]);

  useEffect(() => {
    if (connectionState === 'reconnecting') {
      if (!spokenReconnectingRef.current) {
        spokenReconnectingRef.current = true;
        setTimeout(() => {
          setConductorState('reconnecting');
        }, 0);
        cancelListening();
        cancelSpeechRec();
        narrationTtsService.stopNarration();
        void narrationTtsService.speakNarration({
          text: 'Reconnecting',
          settings: ttsSettings,
          hasTts,
          cacheKey: 'car:v1:status:reconnecting',
          carMode: true,
        });
      }
    } else if (connectionState === 'connected') {
      if (spokenReconnectingRef.current) {
        spokenReconnectingRef.current = false;
        setTimeout(() => {
          void speakTempText('Reconnected. What do you do?', 'car:v1:status:reconnected');
        }, 0);
      }
    }
  }, [connectionState, ttsSettings, hasTts, cancelListening, cancelSpeechRec, speakTempText]);

  useEffect(() => {
    if (!actionPreview) {
      return;
    }

    const readPreview = async () => {
      setConductorState('speaking');
      const actionDesc = `You want to: ${actionPreview.interpretedAction}.`;
      const statDesc = `Stat: ${actionPreview.stat}.`;
      const diffDesc = `Difficulty: ${actionPreview.difficulty}.`;
      const warnings =
        actionPreview.warnings && actionPreview.warnings.length > 0
          ? `Warning: ${actionPreview.warnings.join('. ')}.`
          : '';

      const textToSpeak = `${actionDesc} ${statDesc} ${diffDesc} ${warnings}`;

      const seq: SpokenSegment[] = [
        { type: 'preview', text: textToSpeak },
        { type: 'prompt', text: CONFIRM_ACTION_PROMPT, cacheKey: 'car:v1:prompt:confirm-action' },
      ];

      void playSequence(seq);
    };

    void readPreview();
  }, [actionPreview, playSequence]);

  useEffect(() => {
    if (loading || !session) {
      return;
    }
    const latestTurn = history[history.length - 1];
    const turnId = latestTurn?.id;
    if (turnId !== undefined && lastSpokenTurnIdRef.current !== turnId) {
      lastSpokenTurnIdRef.current = turnId;
      setTimeout(() => {
        speakFullStorySequence();
      }, 0);
    }
  }, [loading, session, history, speakFullStorySequence]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      isPausedRef.current = true;
      narrationTtsService.stopNarration();
      if (listeningTimeoutRef.current) {
        window.clearTimeout(listeningTimeoutRef.current);
      }
    };
  }, []);

  // Speaks a DM question or a retryable explanation from the preview, then listens.
  // The player is no longer confirming anything: the next utterance is theirs.
  const speakDmMessage = useCallback(async (text: string) => {
    confirmingActionRef.current = null;
    addToTranscriptLog(`DM: ${text}`);
    await speakTempText(text);
  }, [addToTranscriptLog, speakTempText]);

  return {
    conductorState,
    isPaused,
    transcriptLog,
    currentSegmentType,
    pauseConductor,
    resumeConductor,
    speakFullStorySequence,
    speakOptionsAndPrompt,
    speakRollNarration,
    speakDmMessage,
    sttError,
    sttStatus: sttState.status,
    recognizedTranscript: 'transcript' in sttState ? sttState.transcript : '',
  };
}
