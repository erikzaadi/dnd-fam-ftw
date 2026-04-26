import { useEffect } from 'react';
import type { Session, TurnResult } from '../types';
import { apiUrl } from '../lib/api';
import { audioManager } from '../audio/audioManager';

interface SessionEventHandlers {
  sessionId: string;
  onNarrating: () => void;
  onTurnComplete: (session: Session, turnResult: TurnResult | null) => void;
  onImageReady: (imageUrl: string) => void;
  onIntervention: (narration: string, session: Session | null, turnResult: TurnResult | null) => void;
  onSanctuaryRecovery: (narration: string, session: Session | null, turnResult: TurnResult | null) => void;
  onPartyUpdate: (session: Session | null) => void;
  onGameOver: (session: Session) => void;
}

export const useSessionEvents = ({
  sessionId,
  onNarrating,
  onTurnComplete,
  onImageReady,
  onIntervention,
  onSanctuaryRecovery,
  onPartyUpdate,
  onGameOver,
}: SessionEventHandlers) => {
  useEffect(() => {
    let es: EventSource;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    const connect = () => {
      es = new EventSource(apiUrl(`/session/${sessionId}/events`), { withCredentials: true });

      es.onmessage = (e: MessageEvent) => {
        const data = JSON.parse(e.data);
        if (data.type === 'dm_narrating') {
          onNarrating();
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
        } else if (data.type === 'image_ready') {
          onImageReady(data.imageUrl);
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
        es.close();
        reconnectTimer = setTimeout(connect, 3000);
      };
    };

    connect();
    return () => {
      es?.close();
      clearTimeout(reconnectTimer);
    };
  // Handlers are intentionally excluded - they are stable callbacks from the parent.
  // Re-running the effect on every render would reconnect the SSE stream unnecessarily.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);
};
