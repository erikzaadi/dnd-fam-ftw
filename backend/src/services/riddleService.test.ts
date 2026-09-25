import { describe, expect, it } from 'vitest';
import type { Choice } from '../types.js';
import type { StoredRiddle } from '../repositories/riddleRepository.js';
import { assessRiddleAction, syncRiddleChoices, toRiddleAttempt } from './riddleService.js';

const riddle: StoredRiddle = {
  id: 'r1',
  sessionId: 's1',
  sourceTurnId: 10,
  sourceTurnNumber: 3,
  canonicalAnswer: 'a piano',
  aliases: [],
  wrongAnswers: ['a jailer'],
  answerKnown: true,
  status: 'active',
  source: 'narration',
};

const text = (value: string) => assessRiddleAction({ kind: 'free_text', text: value }, riddle);
const choice = (overrides: Partial<Choice>): Choice => ({ label: 'x', difficulty: 'normal', stat: 'magic', ...overrides });

describe('assessRiddleAction: typed answers', () => {
  it.each([
    'a piano',
    'piano',
    'The piano!',
    'a grand piano',
    'It\'s a piano',
    'Is it a piano?',
    'The answer is a piano',
    'Solve the riddle with the answer: "A piano"',
    'not a jailer, it\'s a piano',
    'Oh I know! A Piano!',
    'Aha! The piano.',
    'Hmm... is it a piano?',
  ])('accepts "%s" as the correct answer', value => {
    expect(text(value)).toEqual({ type: 'answer', riddleId: 'r1', correct: true });
  });

  it.each([
    'a jailer',
    'The answer is a jailer',
    'My answer: a lighthouse',
    '"a lighthouse"',
  ])('treats "%s" as a definite wrong answer', value => {
    expect(text(value)).toEqual({ type: 'answer', riddleId: 'r1', correct: false });
  });

  it('never counts a negated answer as asserting it', () => {
    expect(text('not a jailer')).toMatchObject({ type: 'unclear' });
    expect(text('The answer is not a jailer')).toMatchObject({ type: 'unclear' });
  });

  it('asks when a known answer appears inside a longer action', () => {
    expect(text('I play the piano with a flourish')).toEqual({ type: 'unclear', question: 'Is "piano" your answer to the riddle?' });
  });

  it('asks when both a right and a wrong answer are asserted', () => {
    expect(text('a piano or a jailer')).toMatchObject({ type: 'unclear' });
    expect(text('A piano! No wait, a jailer!')).toMatchObject({ type: 'unclear' });
  });

  it('treats a bare "yes" as no answer on its own (answering a question needs its context)', () => {
    expect(text('Yes!')).toEqual({ type: 'not_answer' });
  });

  it('asks about a short answer-shaped guess it cannot match', () => {
    expect(text('a lighthouse')).toEqual({ type: 'unclear', question: 'Is that your answer to the riddle?' });
  });

  it.each([
    'Search the door frame for a hint',
    'I answer the call of adventure and draw my sword',
    'I ignore the riddle and search the room',
    'Tuck pushes the drum aside',
  ])('leaves "%s" as an ordinary action', value => {
    expect(text(value)).toEqual({ type: 'not_answer' });
  });

  it('does not reveal the hidden answer in any question', () => {
    for (const value of ['not a jailer', 'a lighthouse', 'a piano or a jailer']) {
      const result = text(value);
      expect(JSON.stringify(result)).not.toContain('piano');
    }
  });
});

describe('assessRiddleAction: choices and state', () => {
  it('judges a tapped answer against stored state, not the flag on the choice', () => {
    expect(assessRiddleAction({ kind: 'choice', choice: choice({ riddleAnswer: 'a piano', riddleCorrect: false }) }, riddle))
      .toEqual({ type: 'answer', riddleId: 'r1', correct: true });
    expect(assessRiddleAction({ kind: 'choice', choice: choice({ riddleAnswer: 'a jailer', riddleCorrect: true }) }, riddle))
      .toEqual({ type: 'answer', riddleId: 'r1', correct: false });
  });

  it('treats non-answer choices as ordinary actions', () => {
    expect(assessRiddleAction({ kind: 'choice', choice: choice({ label: 'Search for a hint' }) }, riddle)).toEqual({ type: 'not_answer' });
  });

  it('ignores answers when no riddle is active', () => {
    expect(assessRiddleAction({ kind: 'free_text', text: 'a piano' }, null)).toEqual({ type: 'not_answer' });
    expect(assessRiddleAction({ kind: 'free_text', text: 'a piano' }, { ...riddle, status: 'solved' })).toEqual({ type: 'not_answer' });
  });

  it('holds answer attempts when the answer is unknown, but lets other actions through', () => {
    const unknown: StoredRiddle = { ...riddle, canonicalAnswer: undefined, answerKnown: false };
    expect(assessRiddleAction({ kind: 'free_text', text: 'The answer is a piano' }, unknown)).toEqual({ type: 'answer_unknown' });
    expect(assessRiddleAction({ kind: 'free_text', text: 'a piano' }, unknown)).toEqual({ type: 'answer_unknown' });
    expect(assessRiddleAction({ kind: 'choice', choice: choice({ riddleAnswer: 'a piano' }) }, unknown)).toEqual({ type: 'answer_unknown' });
    expect(assessRiddleAction({ kind: 'free_text', text: 'Search the door frame for a hint' }, unknown)).toEqual({ type: 'not_answer' });
  });
});

describe('assessRiddleAction: replies to a riddle question', () => {
  const reply = (draft: string, answer: string, question = 'Is that your answer to the riddle?') =>
    assessRiddleAction({ kind: 'free_text', text: draft, clarifications: [{ question, answer }] }, riddle);

  it('confirms the draft as the answer on "yes"', () => {
    expect(reply('I play the piano with a flourish', 'Yes!')).toEqual({ type: 'answer', riddleId: 'r1', correct: true });
    expect(reply('I play the piano with a flourish', 'that\'s my answer')).toEqual({ type: 'answer', riddleId: 'r1', correct: true });
    expect(reply('a lighthouse', 'yep')).toEqual({ type: 'answer', riddleId: 'r1', correct: false });
  });

  it('makes the draft an ordinary action on "no"', () => {
    expect(reply('I play the piano with a flourish', 'No')).toEqual({ type: 'not_answer' });
  });

  it('takes any other reply as the answer itself', () => {
    expect(reply('not a jailer', 'a piano')).toEqual({ type: 'answer', riddleId: 'r1', correct: true });
    expect(reply('not a jailer', 'Yes, a piano!')).toEqual({ type: 'answer', riddleId: 'r1', correct: true });
    expect(reply('a piano or a jailer', 'the jailer')).toEqual({ type: 'answer', riddleId: 'r1', correct: false });
  });

  it('keeps asking when the reply still does not settle it', () => {
    expect(reply('a piano or a jailer', 'yes')).toMatchObject({ type: 'unclear' });
  });

  it('ignores replies when the draft is already clear', () => {
    expect(reply('a piano', 'no')).toEqual({ type: 'answer', riddleId: 'r1', correct: true });
  });
});

describe('toRiddleAttempt', () => {
  it('resolves without a roll', () => {
    expect(toRiddleAttempt('a piano', true).actionResult).toMatchObject({ success: true, roll: 0, statUsed: 'none' });
    expect(toRiddleAttempt('a jailer', false).actionResult).toMatchObject({ success: false, roll: 0, statUsed: 'none' });
  });
});

describe('syncRiddleChoices', () => {
  const key = { canonicalAnswer: 'a piano', aliases: ['piano'] };
  const guessedRiver = choice({ label: 'Answer: a river', riddleAnswer: 'a river', riddleCorrect: true });
  const guessedPiano = choice({ label: 'Say: a grand piano!', riddleAnswer: 'a grand piano', riddleCorrect: false });
  const hint = choice({ label: 'Ask for a hint', stat: 'mischief' });
  const scout = choice({ label: 'Scout the hall', stat: 'might' });
  const keepOrder = () => 0.9;

  it('makes the narrated answer the correct choice and the agent\'s other guess the wrong one', () => {
    expect(syncRiddleChoices([guessedRiver, guessedPiano, hint], key, keepOrder)).toEqual([
      { ...guessedPiano, riddleAnswer: 'a piano', riddleCorrect: true },
      { ...guessedRiver, riddleCorrect: false },
      hint,
    ]);
  });

  it('adds a correct answer choice when the agent offered none, keeping three choices', () => {
    const synced = syncRiddleChoices([hint, scout, choice({ label: 'Rest' })], key, keepOrder);
    expect(synced).toHaveLength(3);
    expect(synced[0]).toMatchObject({ label: 'Answer: a piano', riddleAnswer: 'a piano', riddleCorrect: true });
    expect(synced.slice(1)).toEqual([hint, scout]);
  });

  it('does not always put the right answer first', () => {
    const synced = syncRiddleChoices([guessedRiver, guessedPiano, hint], key, () => 0.1);
    expect(synced[0].riddleCorrect).toBe(false);
    expect(synced[1].riddleCorrect).toBe(true);
  });

  it('turns answer choices into ordinary actions when no riddle is open', () => {
    const synced = syncRiddleChoices([guessedRiver, hint], null);
    expect(synced[0]).toEqual({ label: 'Answer: a river', difficulty: 'normal', stat: 'magic' });
    expect(synced[1]).toEqual(hint);
  });

  it('leaves choices alone when the answer is unknown, and adds nothing to an empty list', () => {
    expect(syncRiddleChoices([guessedRiver, hint], 'unknown')).toEqual([guessedRiver, hint]);
    expect(syncRiddleChoices([], key)).toEqual([]);
  });
});
