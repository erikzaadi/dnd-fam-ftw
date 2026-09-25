import { useEffect, useRef } from 'react';
import type { IdeasPayload, Session, TurnResult } from '../types';
import { currentIdeas, fetchIdeas } from '../lib/ideas';

// Realm setting "Suggest ideas each turn": once a new turn has settled, ask for ideas
// once. Every open view may ask; the server shares one generation per turn and
// revision, so the table gets one set. A failure is not retried for the same turn:
// the Give me ideas button is still there.
export const useAutoIdeas = ({
  sessionId,
  session,
  latestTurn,
  busy,
  onIdeas,
}: {
  sessionId: string;
  session: Session | null;
  latestTurn: TurnResult | null | undefined;
  // A turn is resolving: the server would refuse, and the next turn is coming anyway.
  busy: boolean;
  onIdeas: (payload: IdeasPayload) => void;
}): void => {
  const askedRef = useRef<string | null>(null);
  const onIdeasRef = useRef(onIdeas);
  useEffect(() => {
    onIdeasRef.current = onIdeas;
  }, [onIdeas]);

  const turnId = latestTurn?.id;
  const revision = session?.revision ?? 0;
  const enabled = !!session?.autoIdeas && !session.gameOver && (session.adventure?.status ?? 'active') === 'active';
  const hasIdeas = currentIdeas(latestTurn, { revision: session?.revision, activeCharacterId: session?.activeCharacterId }).length > 0;

  useEffect(() => {
    if (!enabled || busy || turnId === undefined || hasIdeas) {
      return;
    }
    const key = `${turnId}:${revision}`;
    if (askedRef.current === key) {
      return;
    }
    askedRef.current = key;
    void fetchIdeas(sessionId, { turnId, revision }).then(result => {
      if (result.kind === 'ideas') {
        onIdeasRef.current(result.payload);
      }
    });
  }, [busy, enabled, hasIdeas, revision, sessionId, turnId]);
};
