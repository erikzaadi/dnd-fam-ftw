import type { Choice, Session, SessionState, TurnResult } from '../types.js';

// Private DM material that must never reach play views (session GET, SSE payloads).
// The DM-facing session list and edit dialog read DM Prep through their own endpoints.
const PRIVATE_SESSION_FIELDS = [
  'dmPrep',
  'compiledDmPrep',
  'dmPrepEncounters',
  'dmPrepImageBrief',
  'adventurePlan',
] as const;

// Riddle correctness is server-only: clients learn that a choice answers a riddle
// (no roll), never whether it is the right answer.
export const toPublicChoice = (choice: Choice): Choice => {
  const { riddleAnswer, riddleCorrect: _riddleCorrect, ...publicChoice } = choice;
  return riddleAnswer ? { ...publicChoice, kind: 'riddle_answer' } : publicChoice;
};

export const toPublicTurn = <T extends TurnResult>(turn: T): T => ({
  ...turn,
  choices: turn.choices.map(toPublicChoice),
});

export const toPublicSession = <T extends Session | SessionState>(session: T): Session => {
  const copy: Record<string, unknown> = { ...session };
  for (const field of PRIVATE_SESSION_FIELDS) {
    delete copy[field];
  }
  if (Array.isArray(copy.lastChoices)) {
    copy.lastChoices = (copy.lastChoices as Choice[]).map(toPublicChoice);
  }
  return copy as unknown as Session;
};
