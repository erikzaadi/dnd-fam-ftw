import type { AskDmPayload } from '../types';
import { apiFetch } from './api';

export type AskDmResult =
  | { kind: 'answer'; payload: AskDmPayload }
  | { kind: 'error'; error: string; message: string };

// "Ask the DM": a short answer about the current scene. Never advances the story.
// Callers drop an answer whose turn or revision is no longer current.
export const askDm = async (
  sessionId: string,
  request: { question: string; turnId: number; revision: number },
): Promise<AskDmResult> => {
  try {
    const res = await apiFetch(`/session/${sessionId}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    const data = await res.json().catch(() => null) as (AskDmPayload & { error?: string; message?: string }) | null;
    if (res.ok && data?.answer) {
      return { kind: 'answer', payload: data };
    }
    return { kind: 'error', error: data?.error ?? 'ask_failed', message: data?.message ?? 'The DM did not catch that. Ask again.' };
  } catch {
    return { kind: 'error', error: 'network', message: 'Could not reach the realm. Check your connection and try again.' };
  }
};
