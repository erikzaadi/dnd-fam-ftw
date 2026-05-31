import type { ActionAttempt } from '../types.js';

type ActionResult = ActionAttempt['actionResult'];

const POOL: Record<string, Record<string, Record<string, string[]>>> = {
  might: {
    success: {
      extreme: [
        'An overwhelming strike. Pure force prevails.',
        'A devastating blow, landed clean.',
        'Sheer power - spectacular.',
      ],
      strong: [
        'A powerful success. The effort pays off.',
        'Strength carries the day.',
        'A solid, forceful victory.',
      ],
      normal: [
        'Success through grit.',
        'The muscle holds.',
        'A determined effort prevails.',
      ],
    },
    failure: {
      extreme: [
        'A brutal misstep - strength spent for nothing.',
        'The force backfires entirely.',
        'Power misapplied at the worst moment.',
      ],
      strong: [
        'A harsh failure. The effort was not enough.',
        'Strength alone was not the answer here.',
        'The blow does not connect. A painful lesson.',
      ],
      normal: [
        'Not quite there.',
        'The muscle fails this time.',
        'Brute force did not cut it.',
      ],
    },
  },
  magic: {
    success: {
      extreme: [
        'The arcane flows perfectly - a spectacular result.',
        'Magic answers with unexpected force.',
        'An extraordinary magical triumph.',
      ],
      strong: [
        'The spell lands beautifully.',
        'Magic works its will with authority.',
        'A confident magical success.',
      ],
      normal: [
        'The magic holds.',
        'Arcane effort pays off.',
        'A steady magical touch.',
      ],
    },
    failure: {
      extreme: [
        'The magic fizzles catastrophically.',
        'The arcane turns against you.',
        'A spectacular magical failure.',
      ],
      strong: [
        'The spell misfires badly.',
        'Magic slips through the fingers.',
        'The arcane resists - a real setback.',
      ],
      normal: [
        'The magic does not cooperate.',
        'A fizzle. The arcane looks away.',
        'Not enough magic in the moment.',
      ],
    },
  },
  mischief: {
    success: {
      extreme: [
        'Pulled off brilliantly - nobody saw it coming.',
        'A perfect con. Audacious and clean.',
        'Wit and cunning at their absolute peak.',
      ],
      strong: [
        'A sharp, clever success.',
        'Cunning carries the day.',
        'Quick thinking pays off.',
      ],
      normal: [
        'Slippery enough to get through.',
        'Clever as ever.',
        'Just enough mischief to make it work.',
      ],
    },
    failure: {
      extreme: [
        'The scheme unravels spectacularly.',
        'Outsmarted - a painful reversal.',
        'The trick collapses completely.',
      ],
      strong: [
        'The plan falls apart.',
        'Too clever by half this time.',
        'The bluff gets called.',
      ],
      normal: [
        'Not quite sneaky enough.',
        'The trick does not land.',
        'A minor fumble of cunning.',
      ],
    },
  },
};

const NAT_20_PHRASES = [
  'A natural twenty! Extraordinary.',
  'Perfect roll. The dice favor you completely.',
  'Twenty! A legendary moment.',
];

function pickRandom(arr: string[]): string {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function buildRollNarration(actionResult: ActionResult): string {
  const { success, roll, statUsed, impact } = actionResult;
  if (!statUsed || statUsed === 'none') {
    return '';
  }
  if (roll === 20) {
    return pickRandom(NAT_20_PHRASES);
  }
  const outcome = success ? 'success' : 'failure';
  const impactKey = impact ?? 'normal';
  const phrases = POOL[statUsed]?.[outcome]?.[impactKey];
  if (!phrases || phrases.length === 0) {
    return success ? 'Success!' : 'Failure.';
  }
  return pickRandom(phrases);
}
