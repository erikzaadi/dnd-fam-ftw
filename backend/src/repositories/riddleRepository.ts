import { createId } from '../lib/ids.js';
import { getDb } from '../persistence/database.js';
import { withTransaction } from '../persistence/transaction.js';

export type RiddleStatus = 'active' | 'solved' | 'expired' | 'abandoned';

// Server-only riddle state. Never serialize into public payloads.
export type StoredRiddle = {
  id: string;
  sessionId: string;
  sourceTurnId: number;
  sourceTurnNumber: number;
  prompt?: string;
  canonicalAnswer?: string;
  aliases: string[];
  wrongAnswers: string[];
  answerKnown: boolean;
  status: RiddleStatus;
};

type RiddleRow = {
  id: string;
  session_id: string;
  source_turn_id: number;
  source_turn_number: number;
  prompt: string | null;
  canonical_answer: string | null;
  aliases: string;
  wrong_answers: string;
  answer_known: number;
  status: RiddleStatus;
};

const parseList = (raw: string): string[] => {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
};

const fromRow = (row: RiddleRow): StoredRiddle => ({
  id: row.id,
  sessionId: row.session_id,
  sourceTurnId: row.source_turn_id,
  sourceTurnNumber: row.source_turn_number,
  ...(row.prompt && { prompt: row.prompt }),
  ...(row.canonical_answer && { canonicalAnswer: row.canonical_answer }),
  aliases: parseList(row.aliases),
  wrongAnswers: parseList(row.wrong_answers),
  answerKnown: !!row.answer_known,
  status: row.status,
});

export type NewRiddle = Omit<StoredRiddle, 'id' | 'status'>;

export const riddleRepository = {
  getActive(sessionId: string): StoredRiddle | null {
    const row = getDb().prepare("SELECT * FROM session_riddles WHERE session_id = ? AND status = 'active' ORDER BY source_turn_id DESC LIMIT 1")
      .get(sessionId) as RiddleRow | undefined;
    return row ? fromRow(row) : null;
  },

  getBySourceTurn(sessionId: string, sourceTurnId: number): StoredRiddle | null {
    const row = getDb().prepare('SELECT * FROM session_riddles WHERE session_id = ? AND source_turn_id = ?')
      .get(sessionId, sourceTurnId) as RiddleRow | undefined;
    return row ? fromRow(row) : null;
  },

  // A newly posed riddle replaces any older active one. Idempotent per posing turn.
  activate(riddle: NewRiddle): StoredRiddle {
    return withTransaction(() => {
      const db = getDb();
      const existing = riddleRepository.getBySourceTurn(riddle.sessionId, riddle.sourceTurnId);
      if (existing) {
        return existing;
      }
      db.prepare("UPDATE session_riddles SET status = 'expired', updated_at = CURRENT_TIMESTAMP WHERE session_id = ? AND status = 'active'")
        .run(riddle.sessionId);
      const id = createId();
      db.prepare(`INSERT INTO session_riddles (id, session_id, source_turn_id, source_turn_number, prompt, canonical_answer, aliases, wrong_answers, answer_known, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`)
        .run(
          id,
          riddle.sessionId,
          riddle.sourceTurnId,
          riddle.sourceTurnNumber,
          riddle.prompt ?? null,
          riddle.canonicalAnswer ?? null,
          JSON.stringify(riddle.aliases),
          JSON.stringify(riddle.wrongAnswers),
          riddle.answerKnown ? 1 : 0,
        );
      return { ...riddle, id, status: 'active' };
    });
  },

  // Only moves an active riddle: a riddle already solved or expired stays as it is.
  setStatus(id: string, status: Exclude<RiddleStatus, 'active'>): boolean {
    const result = getDb().prepare("UPDATE session_riddles SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'active'")
      .run(status, id);
    return result.changes > 0;
  },
};
