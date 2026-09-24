import type { ActionAttempt, Choice, SessionState } from '../types.js';
import { riddleRepository, type StoredRiddle } from '../repositories/riddleRepository.js';
import { turnHistoryRepository } from '../repositories/turnHistoryRepository.js';

// Riddle answers resolve against authoritative server state (session_riddles), never
// against whatever suggested choices happen to be on screen. Hidden answers stay here:
// callers only learn whether an action is an answer and whether it was right.

// An unanswered riddle stops being active after this many turns, so answer-like text is
// an ordinary action again once the story has clearly moved on.
export const RIDDLE_ACTIVE_TURNS = 4;

export const RIDDLE_ANSWER_UNKNOWN_MESSAGE = 'The DM is still puzzling over that riddle. Try again in a moment.';

export type RiddleAssessment =
  | { type: 'not_answer' }
  | { type: 'answer'; riddleId: string; correct: boolean }
  // The player may be answering, but the server cannot tell what they assert.
  // The question is safe to show: it only repeats the player's own words.
  | { type: 'unclear'; question: string }
  | { type: 'answer_unknown' };

export type RiddleActionInput =
  | { kind: 'choice'; choice: Choice }
  | { kind: 'free_text'; text: string };

const QUOTED_RE = /["“”‘’]([^"“”‘’]+)["“”‘’]/;
// Phrasings that make an action a definite answer attempt. "Answer" as a plain verb
// ("I answer the call") is not one.
const STRONG_ANSWER_RE = /\b(?:answer|solution|guess)\s*(?:is\b|:)|\bmy\s+(?:answer|guess)\b|\bthe\s+answer\b|\briddle\s*:/i;
// Text after the last answer marker is the asserted answer.
const ANSWER_MARKER_RE = /(?:\banswer(?:\s+is)?|\bsolution(?:\s+is)?|\bguess(?:\s+is)?|\briddle|\bi\s+say|\bwe\s+say|\bis\s+it|\bit'?s|\bit\s+is|\bmust\s+be)\s*:?\s*(.+)$/i;
const WEAK_MARKER_RE = /\b(?:i\s+say|we\s+say|is\s+it|it'?s|it\s+is|must\s+be)\b/i;
const NEGATION_RE = /^\s*(?:no\b|not\b|it'?s\s+not\b|it\s+is\s+not\b|it\s+isn'?t\b|isn'?t\b|definitely\s+not\b|i\s+don'?t\s+think\s+it'?s\b)/i;
// Sentences and clauses are judged separately: "Oh I know! A piano!" asserts "a piano".
const CLAUSE_SPLIT_RE = /[,;!?]|\bbut\b|\.(?:\s|$)/i;
// Exclamations around an answer carry no meaning of their own.
const FILLER_RE = /^(?:(?:oh+|ooh+|ah+|aha+|hmm+|um+|wait|well|yes|yeah|yep|ok(?:ay)?|i\s+know|i\s+got\s+it|got\s+it|easy)\b[\s!.]*)+/i;
const DETERMINER_RE = /^\s*(?:a|an|the|my|some)\s+/i;
const LEADING_ARTICLE_RE = /^(?:a|an|the)\s+/;

const normalize = (value: string): string => value
  .toLowerCase()
  .replace(/[^a-z0-9\s]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .replace(LEADING_ARTICLE_RE, '');

// Whole-word match, so "a grand piano" and "the piano of course" match "piano"
// but "pianola" does not. A trailing plural "s" is tolerated.
const matchesAnswer = (candidate: string, answer: string): boolean => {
  const normalizedAnswer = normalize(answer);
  if (!normalizedAnswer || !candidate) {
    return false;
  }
  const padded = ` ${candidate} `;
  return candidate === normalizedAnswer
    || padded.includes(` ${normalizedAnswer} `)
    || padded.includes(` ${normalizedAnswer}s `);
};

const extractCandidate = (text: string): string => {
  const quoted = text.match(QUOTED_RE)?.[1];
  if (quoted) {
    return quoted;
  }
  return text.match(ANSWER_MARKER_RE)?.[1] ?? text;
};

const isNegated = (text: string): boolean => NEGATION_RE.test(text);

const correctAnswers = (riddle: StoredRiddle): string[] =>
  [riddle.canonicalAnswer, ...riddle.aliases].filter((a): a is string => !!a);

// Judges one asserted clause; the caller has already removed negated ones.
const assessClause = (clause: string, riddle: StoredRiddle): RiddleAssessment => {
  const strong = QUOTED_RE.test(clause) || STRONG_ANSWER_RE.test(clause);
  const candidate = normalize(extractCandidate(clause));
  const wordCount = candidate ? candidate.split(' ').length : 0;
  const looksLikeAnswer = strong
    || (wordCount > 0 && wordCount <= 3 && (DETERMINER_RE.test(clause) || WEAK_MARKER_RE.test(clause)));

  if (!riddle.answerKnown) {
    return looksLikeAnswer ? { type: 'answer_unknown' } : { type: 'not_answer' };
  }

  const matchedCorrect = correctAnswers(riddle).find(answer => matchesAnswer(candidate, answer));
  const matchedWrong = riddle.wrongAnswers.find(answer => matchesAnswer(candidate, answer));
  if (matchedCorrect && matchedWrong) {
    return { type: 'unclear', question: 'Which one is your answer to the riddle?' };
  }
  const matched = matchedCorrect ?? matchedWrong;
  if (matched) {
    // A known answer inside a longer action ("I play the piano") might be an answer
    // or might just be an action: ask instead of guessing. The answer itself with at
    // most one extra word ("a grand piano") is an answer.
    const tight = wordCount <= normalize(matched).split(' ').length + 1;
    if (strong || WEAK_MARKER_RE.test(clause) || tight) {
      return { type: 'answer', riddleId: riddle.id, correct: !!matchedCorrect };
    }
    return { type: 'unclear', question: `Is "${normalize(matched)}" your answer to the riddle?` };
  }
  if (strong) {
    return { type: 'answer', riddleId: riddle.id, correct: false };
  }
  if (looksLikeAnswer) {
    return { type: 'unclear', question: 'Is that your answer to the riddle?' };
  }
  return { type: 'not_answer' };
};

const assessFreeText = (text: string, riddle: StoredRiddle): RiddleAssessment => {
  // A quoted answer is kept whole: its own punctuation must not split it.
  const clauses = (QUOTED_RE.test(text) ? [text] : text.split(CLAUSE_SPLIT_RE))
    .map(clause => clause.trim().replace(FILLER_RE, '').trim())
    .filter(Boolean);
  // Only the answer the player asserts counts: "not a jailer" rules one out, it does not answer.
  const asserted = clauses.filter(clause => !isNegated(clause) && !isNegated(extractCandidate(clause)));

  if (asserted.length === 0) {
    const knownAnswers = [...correctAnswers(riddle), ...riddle.wrongAnswers];
    const rulesOutAnswer = clauses.some(clause => knownAnswers.some(answer => matchesAnswer(normalize(clause), answer)));
    return rulesOutAnswer ? { type: 'unclear', question: 'Then what is your answer to the riddle?' } : { type: 'not_answer' };
  }

  const results = asserted.map(clause => assessClause(clause, riddle));
  const answers = results.filter((r): r is Extract<RiddleAssessment, { type: 'answer' }> => r.type === 'answer');
  if (answers.length > 0) {
    // Two clauses asserting different verdicts ("a piano! no wait, a jailer") are two answers.
    return answers.every(a => a.correct === answers[0].correct)
      ? answers[0]
      : { type: 'unclear', question: 'Which one is your answer to the riddle?' };
  }
  return results.find(r => r.type === 'unclear')
    ?? results.find(r => r.type === 'answer_unknown')
    ?? { type: 'not_answer' };
};

export const assessRiddleAction = (action: RiddleActionInput, riddle: StoredRiddle | null): RiddleAssessment => {
  if (!riddle || riddle.status !== 'active') {
    return { type: 'not_answer' };
  }
  if (action.kind === 'choice') {
    const answer = action.choice.riddleAnswer;
    if (!answer) {
      return { type: 'not_answer' };
    }
    if (!riddle.answerKnown) {
      return { type: 'answer_unknown' };
    }
    return { type: 'answer', riddleId: riddle.id, correct: correctAnswers(riddle).some(correct => matchesAnswer(normalize(answer), correct)) };
  }
  return assessFreeText(action.text, riddle);
};

// Records the riddle posed by the latest turn (from its answer choices, flagged by the
// choices agent) and returns the session's active riddle, expiring a stale one.
// Idempotent: safe to call on every validation, preview, and resolution.
export const ensureActiveRiddle = (session: Pick<SessionState, 'id' | 'turn' | 'lastChoices'>): StoredRiddle | null => {
  const latestTurnId = turnHistoryRepository.getLatestTurnId(session.id);
  const riddleChoices = (session.lastChoices ?? []).filter(choice => !!choice.riddleAnswer);
  if (latestTurnId !== null && riddleChoices.length > 0 && !riddleRepository.getBySourceTurn(session.id, latestTurnId)) {
    // Only a choice explicitly flagged correct can establish the answer.
    const correct = riddleChoices.filter(choice => choice.riddleCorrect === true).map(choice => choice.riddleAnswer as string);
    riddleRepository.activate({
      sessionId: session.id,
      sourceTurnId: latestTurnId,
      sourceTurnNumber: session.turn,
      ...(correct[0] && { canonicalAnswer: correct[0] }),
      aliases: correct.slice(1),
      wrongAnswers: riddleChoices.filter(choice => choice.riddleCorrect === false).map(choice => choice.riddleAnswer as string),
      answerKnown: correct.length > 0,
    });
  }

  const active = riddleRepository.getActive(session.id);
  if (active && session.turn - active.sourceTurnNumber > RIDDLE_ACTIVE_TURNS) {
    riddleRepository.setStatus(active.id, 'expired');
    return null;
  }
  return active;
};

export const toRiddleAttempt = (action: string, success: boolean): ActionAttempt => ({
  actionAttempt: action,
  actionResult: {
    success,
    roll: 0,
    statUsed: 'none',
    impact: success ? 'normal' : 'strong',
  },
});
