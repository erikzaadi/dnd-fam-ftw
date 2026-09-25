import type { ActionClarification, FreeActionPreview, PreviewClarification } from '../types';
import { apiFetch } from './api';

// An open question from the DM about a draft action. The client keeps the original
// draft and every earlier round, and sends them all with the next preview, so a short
// reply ("yes", "the goblin") is read together with what the player first wrote.
export type ClarificationThread = {
  originalDraft: string;
  exchange: ActionClarification[];
  question: string;
};

export type PreviewRequestResult =
  | { kind: 'preview'; preview: Partial<FreeActionPreview>; originalDraft: string }
  | { kind: 'clarification'; thread: ClarificationThread }
  // Retryable and explained: show the message, keep the draft.
  | { kind: 'error'; message: string; originalDraft: string }
  // Network or server failure: callers fall back to their default preview.
  | { kind: 'failed'; originalDraft: string };

// Previews typed text. With an open thread, the text is the reply to its question.
export const requestActionPreview = async (
  sessionId: string,
  text: string,
  thread: ClarificationThread | null,
): Promise<PreviewRequestResult> => {
  const originalDraft = thread ? thread.originalDraft : text;
  const clarifications = thread ? [...thread.exchange, { question: thread.question, answer: text }] : [];
  try {
    const res = await apiFetch(`/session/${sessionId}/preview-action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: originalDraft,
        supports: ['clarification'],
        ...(clarifications.length > 0 && { clarifications }),
      }),
    });
    const body = await res.json().catch(() => null) as (Partial<FreeActionPreview> & Partial<PreviewClarification> & { error?: string; message?: string }) | null;
    if (res.ok && body?.kind === 'clarification' && body.question) {
      return { kind: 'clarification', thread: { originalDraft, exchange: clarifications, question: body.question } };
    }
    if (res.ok && body) {
      return { kind: 'preview', preview: body, originalDraft };
    }
    if ((res.status === 409 || res.status === 429) && body?.message) {
      return { kind: 'error', message: body.message, originalDraft };
    }
  } catch {
    // fall through
  }
  return { kind: 'failed', originalDraft };
};

// While a DM question is open, "yes" and "no" are answers. Only these words drop the
// question so the player can start a new draft.
const DROP_QUESTION_WORDS = new Set(['cancel', 'cancel action', 'abort', 'go back', 'never mind', 'nevermind', 'start over']);

export const isDropQuestionCommand = (text: string): boolean =>
  DROP_QUESTION_WORDS.has(text.trim().toLowerCase().replace(/[.!?]+$/, ''));
