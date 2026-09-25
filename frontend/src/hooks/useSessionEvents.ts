import { useEffect, useRef, useState } from 'react';
import type { Session, TurnResult, Character, ImageReadyEvent, ActionAttempt, HpChange, IdeasPayload } from '../types';
import { apiUrl } from '../lib/api';
import { devLog } from '../lib/devLog';

const SSE_STALE_TIMEOUT_MS = 60000;
const SSE_STALE_CHECK_MS = 10000;
const SSE_RECONNECT_DELAY_MS = 3000;

export interface NarratingPayload {
  action?: string;
  statUsed?: string;
  difficulty?: string;
  difficultyValue?: number;
  character?: Character;
  helperBonus?: number;
  helperCharacterName?: string;
  choiceItemBonus?: number;
  choiceItemName?: string;
  choiceItemOwnerName?: string;
  characterBonus?: number;
  characterBonusLabel?: string;
  flavor?: string;
}

// Operation metadata attached by the server to lifecycle events.
export interface OperationEventMeta {
  operationId?: string;
  revision?: number;
  // The committed turn wiped the party; a rescue turn follows in the same operation.
  recovering?: boolean;
  // The committed turn resolved the chapter; the ending follows in the same operation.
  concluding?: boolean;
}

interface SessionEventHandlers {
  sessionId: string;
  onConnected?: () => void;
  onSessionUpdated?: (revision: number, changes: Partial<Session>) => void;
  onNarrating: (payload: NarratingPayload) => void;
  onNarrationChunk?: (text: string, field: 'rollNarration' | 'narration') => void;
  onRollNarrationDone?: (rollNarration: string | null, actionResult?: ActionAttempt['actionResult'], hpChanges?: HpChange[]) => void;
  onNarrationStreamingDone?: (narration: string, rollNarration: string | null) => void;
  onNarrationChunkAbort?: () => void;
  onTurnComplete: (session: Session, turnResult: TurnResult | null, meta?: OperationEventMeta) => void;
  onTurnError: (error: string, message: string, meta?: OperationEventMeta) => void;
  onImageReady: (event: ImageReadyEvent) => void;
  onIntervention: (narration: string, session: Session | null, turnResult: TurnResult | null, meta?: OperationEventMeta) => void;
  onSanctuaryRecovery: (narration: string, session: Session | null, turnResult: TurnResult | null, meta?: OperationEventMeta) => void;
  onPartyUpdate: (session: Session | null) => void;
  onGameOver: (session: Session, meta?: OperationEventMeta) => void;
  // The adventure's ending was committed (a conclusion turn with no choices).
  onAdventureConcluded?: (session: Session, turnResult: TurnResult | null, meta?: OperationEventMeta) => void;
  // An ending is being written (end-here request, or a resolved finale).
  onAdventureConcluding?: () => void;
  // Ideas were generated for a turn (by this viewer or another). Not a turn: no narration,
  // dice, or turn effects. Handlers must apply it idempotently.
  onIdeasUpdated?: (payload: IdeasPayload) => void;
}

export type ConnectionState = 'connected' | 'reconnecting' | 'disconnected';

export const useSessionEvents = ({
  sessionId,
  onConnected,
  onSessionUpdated,
  onNarrating,
  onNarrationChunk,
  onRollNarrationDone,
  onNarrationStreamingDone,
  onNarrationChunkAbort,
  onTurnComplete,
  onTurnError,
  onImageReady,
  onIntervention,
  onSanctuaryRecovery,
  onPartyUpdate,
  onGameOver,
  onAdventureConcluded,
  onAdventureConcluding,
  onIdeasUpdated,
}: SessionEventHandlers) => {
  const [connectionState, setConnectionState] = useState<ConnectionState>('connected');
  const setConnectionStateRef = useRef(setConnectionState);
  setConnectionStateRef.current = setConnectionState;

  useEffect(() => {
    let es: EventSource;
    let reconnectTimer: ReturnType<typeof setTimeout>;
    let lastMessageAt = Date.now();
    let closed = false;

    const scheduleReconnect = () => {
      if (closed) {
        return;
      }
      es?.close();
      setConnectionStateRef.current('reconnecting');
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connect, SSE_RECONNECT_DELAY_MS);
    };

    const connect = () => {
      lastMessageAt = Date.now();
      es = new EventSource(apiUrl(`/session/${sessionId}/events`), { withCredentials: true });

      es.onmessage = (e: MessageEvent) => {
        setConnectionStateRef.current('connected');
        lastMessageAt = Date.now();
        const data = JSON.parse(e.data);
        if (data.type !== 'narration_chunk') {
          devLog.log(`[SSE] ${data.type ?? 'message'}`, data);
        }
        const meta: OperationEventMeta = {
          ...(data.operationId && { operationId: data.operationId }),
          ...(typeof data.revision === 'number' && { revision: data.revision }),
          ...(data.recovering && { recovering: true }),
          ...(data.concluding && { concluding: true }),
        };
        if (data.type === 'connected') {
          onConnected?.();
        } else if (data.type === 'narration_chunk') {
          onNarrationChunk?.(data.text, data.field);
        } else if (data.type === 'narration_roll_ready') {
          onRollNarrationDone?.(data.rollNarration ?? null, data.actionResult ?? undefined, data.hpChanges ?? undefined);
        } else if (data.type === 'narration_streaming_done') {
          onNarrationStreamingDone?.(data.narration, data.rollNarration ?? null);
        } else if (data.type === 'narration_chunk_abort') {
          onNarrationChunkAbort?.();
        } else if (data.type === 'dm_narrating') {
	  onNarrating({
	    action: data.action,
	    statUsed: data.statUsed,
	    difficulty: data.difficulty,
	    difficultyValue: data.difficultyValue,
	    character: data.character,
	    helperBonus: data.helperBonus,
	    helperCharacterName: data.helperCharacterName,
	    choiceItemBonus: data.choiceItemBonus,
	    choiceItemName: data.choiceItemName,
	    choiceItemOwnerName: data.choiceItemOwnerName,
	    characterBonus: data.characterBonus,
	    characterBonusLabel: data.characterBonusLabel,
	    flavor: data.flavor,
	  });
        } else if (data.type === 'turn_complete') {
          onTurnComplete(data.session, data.turnResult ?? null, meta);
        } else if (data.type === 'turn_error') {
          onTurnError(data.error ?? 'turn_failed', data.message ?? 'Something went wrong. Please try again.', meta);
        } else if (data.type === 'session_updated') {
          if (typeof data.revision === 'number') {
            onSessionUpdated?.(data.revision, data.changes ?? {});
          }
        } else if (data.type === 'image_ready') {
          onImageReady(data as ImageReadyEvent);
        } else if (data.type === 'intervention') {
          onIntervention(
            data.turnResult?.narration ?? 'A mysterious force saved the party!',
            data.session ?? null,
            data.turnResult ?? null,
            meta,
          );
        } else if (data.type === 'sanctuary_recovery') {
          onSanctuaryRecovery(
            data.turnResult?.narration ?? 'The party found sanctuary...',
            data.session ?? null,
            data.turnResult ?? null,
            meta,
          );
        } else if (data.type === 'party_update') {
          onPartyUpdate(data.session ?? null);
        } else if (data.type === 'game_over') {
          onGameOver(data.session, meta);
        } else if (data.type === 'adventure_concluding') {
          onAdventureConcluding?.();
        } else if (data.type === 'adventure_concluded') {
          onAdventureConcluded?.(data.session, data.turnResult ?? null, meta);
        } else if (data.type === 'ideas_updated') {
          onIdeasUpdated?.(data as IdeasPayload);
        }
      };

      es.onerror = () => {
        scheduleReconnect(); 
      };
    };

    connect();
    const staleTimer = setInterval(() => {
      if (Date.now() - lastMessageAt > SSE_STALE_TIMEOUT_MS) {
        scheduleReconnect(); 
      }
    }, SSE_STALE_CHECK_MS);

    return () => {
      closed = true;
      es?.close();
      clearTimeout(reconnectTimer);
      clearInterval(staleTimer);
    };
  // Handlers are intentionally excluded - they are stable callbacks from the parent.
  // Re-running the effect on every render would reconnect the SSE stream unnecessarily.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  return { connectionState };
};
