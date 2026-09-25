import type { Choice, IdeasPayload, TurnResult } from '../types';
import { apiFetch } from './api';

// Suggested actions ("ideas") belong to one turn, revision, and acting hero. Mirrors the
// server rule (turnHistoryRepository.areIdeasCurrent): stale ideas are hidden, and the
// server rejects them anyway.
export const areIdeasCurrent = (
  turn: Pick<TurnResult, 'ideasRevision' | 'ideasCharacterId'>,
  view: { revision?: number; activeCharacterId?: string },
): boolean =>
  turn.ideasRevision == null
  || view.revision === undefined
  || (turn.ideasRevision === view.revision && (!turn.ideasCharacterId || !view.activeCharacterId || turn.ideasCharacterId === view.activeCharacterId));

// The latest turn's ideas, or none when they went stale.
export const currentIdeas = (latestTurn: TurnResult | null | undefined, view: { revision?: number; activeCharacterId?: string }): Choice[] =>
  latestTurn && areIdeasCurrent(latestTurn, view) ? latestTurn.choices : [];

// Applies ideas (response or ideas_updated event) to the turn they were made for.
// Idempotent, so the requester's response and its own broadcast can both arrive.
export const applyIdeasPayload = (history: TurnResult[], payload: IdeasPayload): TurnResult[] =>
  history.map(turn => (turn.id === payload.turnId
    ? { ...turn, choices: payload.choices, ideasRevision: payload.revision, ideasCharacterId: payload.characterId, ideasDegraded: payload.degraded || undefined }
    : turn));

export type IdeasRequestResult =
  | { kind: 'ideas'; payload: IdeasPayload }
  | { kind: 'error'; error: string; message: string };

export const fetchIdeas = async (
  sessionId: string,
  body: { turnId: number; revision: number; reason?: 'onboarding_auto'; retry?: boolean },
): Promise<IdeasRequestResult> => {
  try {
    const res = await apiFetch(`/session/${sessionId}/ideas`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null) as (IdeasPayload & { error?: string; message?: string }) | null;
    if (res.ok && data?.choices) {
      return { kind: 'ideas', payload: data };
    }
    return { kind: 'error', error: data?.error ?? 'ideas_failed', message: data?.message ?? 'Could not get ideas. Try again.' };
  } catch {
    return { kind: 'error', error: 'network', message: 'Could not reach the realm. Check your connection and try again.' };
  }
};
