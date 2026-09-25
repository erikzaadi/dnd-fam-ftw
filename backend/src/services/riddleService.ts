import type { ActionAttempt, ActionClarification, Choice, SessionState } from '../types.js';
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
  // clarifications: the player's replies to earlier questions about this same draft.
  | { kind: 'free_text'; text: string; clarifications?: ActionClarification[] };

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
// Whole replies to a riddle question. "Yes, a piano" is an answer, not a bare yes.
const AFFIRMATIVE_REPLY_RE = /^\s*(?:yes|yeah|yep|yup|sure|correct|right|definitely|of\s+course|uh[\s-]?huh|mhm|that'?s\s+(?:it|right|my\s+answer)|it\s+is)(?:\s+(?:it\s+is|please))?[\s!.]*$/i;
const NEGATIVE_REPLY_RE = /^\s*(?:no|nope|nah|not\s+really|no\s+way|never\s*mind)[\s!.]*$/i;

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

// True when text names the riddle's answer anywhere (whole words). Used to keep answers
// out of anything shown to players outside the riddle itself, e.g. Ask the DM.
export const mentionsRiddleAnswer = (text: string, riddle: StoredRiddle): boolean => {
  const candidate = normalize(text);
  return correctAnswers(riddle).some(answer => matchesAnswer(candidate, answer));
};

// Judges one asserted clause; the caller has already removed negated ones.
// forceAnswer: the player was asked about the riddle, so what they assert is their answer.
const assessClause = (clause: string, riddle: StoredRiddle, forceAnswer: boolean): RiddleAssessment => {
  const strong = forceAnswer || QUOTED_RE.test(clause) || STRONG_ANSWER_RE.test(clause);
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

const assessFreeText = (text: string, riddle: StoredRiddle, forceAnswer = false): RiddleAssessment => {
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

  const results = asserted.map(clause => assessClause(clause, riddle, forceAnswer));
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
  const base = assessFreeText(action.text, riddle);
  const reply = action.clarifications?.at(-1)?.answer;
  if (base.type !== 'unclear' || !reply) {
    return base;
  }
  // The player was asked about the riddle. "Yes" confirms the draft as their answer,
  // "no" makes it an ordinary action, anything else is their answer.
  if (AFFIRMATIVE_REPLY_RE.test(reply)) {
    return assessFreeText(action.text, riddle, true);
  }
  if (NEGATIVE_REPLY_RE.test(reply)) {
    return { type: 'not_answer' };
  }
  return assessFreeText(reply, riddle, true);
};

// Returns the session's active riddle, expiring a stale one. Riddles posed by narration
// are recorded when their turn commits. For turns from before that (no riddle row, but
// answer choices flagged by the choices agent), the riddle is recorded here on first use.
// Idempotent: safe to call on every validation, preview, and resolution.
export const ensureActiveRiddle = (session: Pick<SessionState, 'id' | 'turn' | 'lastChoices'>): StoredRiddle | null => {
  const latestTurnId = turnHistoryRepository.getLatestTurnId(session.id);
  const riddleChoices = (session.lastChoices ?? []).filter(choice => !!choice.riddleAnswer);
  const current = riddleRepository.getActive(session.id);
  const narrationOwnsRiddle = current?.source === 'narration';
  if (latestTurnId !== null && riddleChoices.length > 0 && !narrationOwnsRiddle && !riddleRepository.getBySourceTurn(session.id, latestTurnId)) {
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
      source: 'choices',
    });
  }

  const active = riddleRepository.getActive(session.id);
  if (active && session.turn - active.sourceTurnNumber > RIDDLE_ACTIVE_TURNS) {
    riddleRepository.setStatus(active.id, 'expired');
    return null;
  }
  return active;
};

export type RiddleAnswerKey = { canonicalAnswer: string; aliases: string[] };

const withoutRiddleFields = ({ riddleAnswer: _riddleAnswer, riddleCorrect: _riddleCorrect, ...choice }: Choice): Choice => choice;

// Answer choices always follow the authoritative riddle. The choices agent runs in
// parallel with narration and never sees it, so it can guess another answer, invent a
// riddle nobody posed, or offer none. riddle: the answer key, 'unknown' (leave the
// choices alone), or null (no riddle: answer choices become ordinary actions).
// addIfMissing: add a correct answer choice when the agent offered none. Only for the
// turn that posed the riddle and for ideas: on later turns the story may have moved on,
// and injecting answers would keep an old riddle alive.
export const syncRiddleChoices = (
  choices: Choice[],
  riddle: RiddleAnswerKey | 'unknown' | null,
  options: { addIfMissing?: boolean; random?: () => number } = {},
): Choice[] => {
  const { addIfMissing = true, random = Math.random } = options;
  if (riddle === 'unknown' || choices.length === 0) {
    return choices;
  }
  if (!riddle) {
    return choices.map(choice => (choice.riddleAnswer ? withoutRiddleFields(choice) : choice));
  }
  const isCorrect = (answer: string) => [riddle.canonicalAnswer, ...riddle.aliases].some(correct => matchesAnswer(normalize(answer), correct));
  const answers = choices.filter(choice => !!choice.riddleAnswer);
  if (answers.length === 0 && !addIfMissing) {
    return choices;
  }
  const others = choices.filter(choice => !choice.riddleAnswer);
  const agentCorrect = answers.find(choice => isCorrect(choice.riddleAnswer as string));
  const template = answers[0];
  const correct: Choice = agentCorrect
    ? { ...agentCorrect, riddleAnswer: riddle.canonicalAnswer, riddleCorrect: true }
    : {
      label: `Answer: ${riddle.canonicalAnswer}`,
      difficulty: template?.difficulty ?? 'normal',
      stat: template?.stat ?? 'mischief',
      ...(template?.difficultyValue !== undefined && { difficultyValue: template.difficultyValue }),
      riddleAnswer: riddle.canonicalAnswer,
      riddleCorrect: true,
    };
  const wrong = answers.find(choice => !isCorrect(choice.riddleAnswer as string));
  const answerChoices = wrong ? [correct, { ...wrong, riddleCorrect: false }] : [correct];
  // The right answer is not always first: position must not give it away.
  if (answerChoices.length === 2 && random() < 0.5) {
    answerChoices.reverse();
  }
  return [...answerChoices, ...others].slice(0, choices.length);
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
