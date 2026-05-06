import type { ActionAttempt, Choice } from '../types.js';

const ANSWER_PREFIX_RE = /\b(?:answer|solution|solve|guess|say|with)\b\s*:?\s*/i;
const QUOTED_RE = /["'“”‘’]([^"'“”‘’]+)["'“”‘’]/;
const LEADING_ARTICLE_RE = /^(?:a|an|the)\s+/;

const normalize = (value: string): string => value
  .toLowerCase()
  .replace(/[^a-z0-9\s]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .replace(LEADING_ARTICLE_RE, '');

const extractAnswerText = (action: string): string => {
  const quoted = action.match(QUOTED_RE)?.[1];
  if (quoted) {
    return quoted;
  }
  const prefixIndex = action.search(ANSWER_PREFIX_RE);
  if (prefixIndex >= 0) {
    return action.slice(prefixIndex).replace(ANSWER_PREFIX_RE, '');
  }
  return action;
};

const choiceIsRiddleAnswer = (choice: Choice): boolean => !!choice.riddleAnswer;

function toAttempt(action: string, success: boolean): ActionAttempt {
  return {
    actionAttempt: action,
    actionResult: {
      success,
      roll: 0,
      statUsed: 'none',
      impact: success ? 'normal' : 'strong',
    },
  };
}

export function resolveRiddleAnswer(action: string, choices: Choice[]): ActionAttempt | null {
  const riddleChoices = choices.filter(choiceIsRiddleAnswer);
  if (riddleChoices.length === 0) {
    return null;
  }

  const labelMatch = riddleChoices.find(choice => choice.label === action);
  if (labelMatch) {
    return toAttempt(action, !!labelMatch.riddleCorrect);
  }

  const normalizedAction = normalize(extractAnswerText(action));
  const matchedAnswer = riddleChoices.find(choice => {
    const normalizedAnswer = normalize(choice.riddleAnswer ?? '');
    return normalizedAnswer.length > 0 && (
      normalizedAction === normalizedAnswer ||
      normalizedAction.includes(normalizedAnswer)
    );
  });

  return matchedAnswer ? toAttempt(action, !!matchedAnswer.riddleCorrect) : null;
}
