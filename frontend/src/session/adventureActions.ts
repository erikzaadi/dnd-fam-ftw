import type { AdventureFormat, AdventureProgress, Session, TurnResult } from '../types';
import { apiFetch } from '../lib/api';
import { submitSessionOperation, type SubmitOperationResult } from './sessionOperations';

export type AdventureMutationResult =
  | { ok: true; revision: number; adventure?: AdventureProgress }
  | { ok: false; message: string };

const mutate = async (path: string, method: 'POST' | 'PATCH', body: Record<string, unknown>): Promise<AdventureMutationResult> => {
  try {
    const res = await apiFetch(path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({})) as { revision?: number; adventure?: AdventureProgress; message?: string };
    if (!res.ok) {
      return { ok: false, message: data.message ?? 'That did not work. Please try again.' };
    }
    return { ok: true, revision: data.revision ?? 0, ...(data.adventure && { adventure: data.adventure }) };
  } catch {
    return { ok: false, message: 'Could not reach the realm. Check your connection and try again.' };
  }
};

// Asks the DM for a near-term finale. No outcome is decided by this call.
export const requestWrapUp = (sessionId: string, expectedRevision?: number) =>
  mutate(`/session/${sessionId}/adventure/wrap-up`, 'POST', { expectedRevision });

export const setAdventureFormat = (sessionId: string, adventureFormat: AdventureFormat, expectedRevision?: number) =>
  mutate(`/session/${sessionId}`, 'PATCH', { adventureFormat, expectedRevision });

// Realm setting "Suggest ideas each turn".
export const setAutoIdeas = (sessionId: string, autoIdeas: boolean, expectedRevision?: number) =>
  mutate(`/session/${sessionId}`, 'PATCH', { autoIdeas, expectedRevision });

// Ends the evening now with an epilogue grounded in what actually happened.
export const endAdventureHere = (sessionId: string, expectedRevision?: number): Promise<SubmitOperationResult> =>
  submitSessionOperation(`/session/${sessionId}/adventure/end`, { expectedRevision });

export const continueWorld = (sessionId: string, adventureFormat: AdventureFormat, expectedRevision?: number): Promise<SubmitOperationResult> =>
  submitSessionOperation(`/session/${sessionId}/adventure/continue`, { adventureFormat, expectedRevision });

export const isAdventureCompleted = (session: Pick<Session, 'adventure' | 'gameOver'> | null | undefined): boolean =>
  !!session && !session.gameOver && session.adventure?.status === 'completed';

export const isAdventureConcluding = (session: Pick<Session, 'adventure'> | null | undefined): boolean =>
  session?.adventure?.status === 'concluding';

export const findConclusionTurn = (session: Pick<Session, 'adventure'> | null | undefined, history: TurnResult[]): TurnResult | null => {
  const id = session?.adventure?.conclusionTurnId;
  return (id !== undefined ? history.find(turn => turn.id === id) : undefined)
    ?? [...history].reverse().find(turn => turn.turnType === 'conclusion')
    ?? null;
};

export const ADVENTURE_PHASE_LABELS: Record<AdventureProgress['phase'], string> = {
  opening: 'The adventure begins',
  development: 'The plot thickens',
  finale: 'The finale',
  epilogue: 'The ending',
};
