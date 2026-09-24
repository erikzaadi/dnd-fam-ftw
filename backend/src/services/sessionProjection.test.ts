import { describe, expect, it } from 'vitest';
import type { Choice, SessionState, TurnResult } from '../types.js';
import { toPublicChoice, toPublicSession, toPublicTurn } from './sessionProjection.js';

const correct: Choice = { id: 1, label: 'Answer: a piano', difficulty: 'normal', stat: 'magic', riddleAnswer: 'a piano', riddleCorrect: true };
const wrong: Choice = { id: 2, label: 'Answer: a jailer', difficulty: 'normal', stat: 'magic', riddleAnswer: 'a jailer', riddleCorrect: false };
const plain: Choice = { id: 3, label: 'Search the door frame', difficulty: 'easy', stat: 'mischief', flavor: 'standard' };

describe('toPublicChoice', () => {
  it('replaces riddle answers with a marker that does not reveal correctness', () => {
    expect(toPublicChoice(correct)).toEqual({ id: 1, label: 'Answer: a piano', difficulty: 'normal', stat: 'magic', kind: 'riddle_answer' });
    expect(toPublicChoice(wrong)).toEqual({ id: 2, label: 'Answer: a jailer', difficulty: 'normal', stat: 'magic', kind: 'riddle_answer' });
  });

  it('leaves ordinary choices unchanged', () => {
    expect(toPublicChoice(plain)).toEqual(plain);
  });
});

describe('toPublicTurn / toPublicSession', () => {
  it('strips riddle fields from turn choices without mutating the stored turn', () => {
    const turn: TurnResult = { narration: 'A riddle.', choices: [correct, wrong, plain], imagePrompt: null, imageSuggested: false };
    const publicTurn = toPublicTurn(turn);
    expect(JSON.stringify(publicTurn)).not.toMatch(/riddleAnswer|riddleCorrect/);
    expect(turn.choices[0].riddleCorrect).toBe(true);
  });

  it('strips riddle fields from the session\'s latest choices', () => {
    const session = { id: 's1', lastChoices: [correct, wrong], dmPrep: 'secret' } as unknown as SessionState;
    const publicSession = toPublicSession(session) as unknown as Record<string, unknown>;
    expect(JSON.stringify(publicSession)).not.toMatch(/riddleAnswer|riddleCorrect/);
    expect(publicSession.dmPrep).toBeUndefined();
    expect((publicSession.lastChoices as Choice[]).map(c => c.kind)).toEqual(['riddle_answer', 'riddle_answer']);
  });
});
