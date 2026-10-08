// A Realtime model reads narration aloud, but it is a conversational model and
// can add words of its own ("Sure, here it is...") or stop early. The provider
// returns a transcript of what was spoken; this decides whether that transcript
// is the requested text.
//
// It is deliberately tolerant inside the text: transcripts respell things
// ("3" as "three", "Mr." as "Mister") while the speech is correct. What it
// catches is what breaks the game: extra words at the start or end, and
// missing or added passages.

const EDGE_WORDS = 3;
// Respelling changes the word count a little (e.g. "21" becomes "twenty one").
const LENGTH_SLACK_RATIO = 0.15;
const LENGTH_SLACK_WORDS = 2;

const NUMBER_WORDS = new Set([
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen',
  'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety', 'hundred', 'thousand',
  'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth',
]);

const NUMBER = '#';

// Lowercase words without punctuation; every number, however it is spelled,
// becomes one placeholder so digits and number words compare equal.
export function speechWords(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter(Boolean)
    .map(word => (/^\d/.test(word) || NUMBER_WORDS.has(word) ? NUMBER : word));
  return words.filter((word, index) => !(word === NUMBER && words[index - 1] === NUMBER));
}

export type TranscriptVerdict =
  | { ok: true }
  | { ok: false; reason: 'added_or_missing_start' | 'added_or_missing_end' | 'length_differs' };

export function checkSpokenTranscript(text: string, transcript: string): TranscriptVerdict {
  const expected = speechWords(text);
  const spoken = speechWords(transcript);
  const edge = Math.min(EDGE_WORDS, expected.length);

  if (expected.slice(0, edge).join(' ') !== spoken.slice(0, edge).join(' ')) {
    return { ok: false, reason: 'added_or_missing_start' };
  }
  if (expected.slice(expected.length - edge).join(' ') !== spoken.slice(Math.max(0, spoken.length - edge)).join(' ')) {
    return { ok: false, reason: 'added_or_missing_end' };
  }
  const slack = Math.max(LENGTH_SLACK_WORDS, Math.ceil(expected.length * LENGTH_SLACK_RATIO));
  if (Math.abs(expected.length - spoken.length) > slack) {
    return { ok: false, reason: 'length_differs' };
  }
  return { ok: true };
}
