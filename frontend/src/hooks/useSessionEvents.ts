import { useEffect, useRef, useState } from 'react';
import type { Session, TurnResult, Character, ImageReadyEvent } from '../types';
import { apiUrl } from '../lib/api';
import { audioManager } from '../audio/audioManager';

const SSE_STALE_TIMEOUT_MS = 60000;
const SSE_STALE_CHECK_MS = 10000;
const SSE_RECONNECT_DELAY_MS = 3000;
const isDev = import.meta.env.DEV;

interface NarratingPayload {
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

interface SessionEventHandlers {
  sessionId: string;
  onNarrating: (payload: NarratingPayload) => void;
  onTurnComplete: (session: Session, turnResult: TurnResult | null) => void;
  onTurnError: (error: string, message: string) => void;
  onImageReady: (event: ImageReadyEvent) => void;
  onIntervention: (narration: string, session: Session | null, turnResult: TurnResult | null) => void;
  onSanctuaryRecovery: (narration: string, session: Session | null, turnResult: TurnResult | null) => void;
  onPartyUpdate: (session: Session | null) => void;
  onGameOver: (session: Session) => void;
}

export type ConnectionState = 'connected' | 'reconnecting' | 'disconnected';

export const useSessionEvents = ({
  sessionId,
  onNarrating,
  onTurnComplete,
  onTurnError,
  onImageReady,
  onIntervention,
  onSanctuaryRecovery,
  onPartyUpdate,
  onGameOver,
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
        if (isDev) {
          console.log(`[SSE] ${data.type ?? 'message'}`, data);
        }
        if (data.type === 'dm_narrating') {
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
          if (data.turnResult?.currentTensionLevel) {
            audioManager.setTension(data.turnResult.currentTensionLevel);
          }
          const roll = data.turnResult?.lastAction?.actionResult;
          if (roll && roll.statUsed !== 'none') {
            audioManager.playSfx('dice-roll');
            setTimeout(() => {
              if (roll.roll === 20) {
                audioManager.playSfx('roll-20');
              } else if (roll.success) {
                audioManager.playSfx('success-roll');
              } else {
                audioManager.playSfx('failed-roll');
              }
            }, 600);
          }
          onTurnComplete(data.session, data.turnResult ?? null);
        } else if (data.type === 'turn_error') {
          onTurnError(data.error ?? 'turn_failed', data.message ?? 'Something went wrong. Please try again.');
        } else if (data.type === 'image_ready') {
          onImageReady(data as ImageReadyEvent);
        } else if (data.type === 'intervention') {
          onIntervention(
            data.turnResult?.narration ?? 'A mysterious force saved the party!',
            data.session ?? null,
            data.turnResult ?? null,
          );
        } else if (data.type === 'sanctuary_recovery') {
          onSanctuaryRecovery(
            data.turnResult?.narration ?? 'The party found sanctuary...',
            data.session ?? null,
            data.turnResult ?? null,
          );
        } else if (data.type === 'party_update') {
          onPartyUpdate(data.session ?? null);
        } else if (data.type === 'game_over') {
          onGameOver(data.session);
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
