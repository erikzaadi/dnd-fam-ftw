export type SpeechIntent =
  | { type: 'choice'; index: 0 | 1 | 2 | 3; transcript: string }
  | { type: 'custom'; text: string; transcript: string };

const CHOICE_PHRASES: Record<0 | 1 | 2 | 3, string[]> = {
  0: ['1', 'one', 'first', 'option one', 'option 1', 'action one', 'action 1', 'choice one', 'choice 1', 'number one', 'number 1'],
  1: ['2', 'two', 'second', 'option two', 'option 2', 'action two', 'action 2', 'choice two', 'choice 2', 'number two', 'number 2'],
  2: ['3', 'three', 'third', 'option three', 'option 3', 'action three', 'action 3', 'choice three', 'choice 3', 'number three', 'number 3'],
  3: ['4', 'four', 'fourth', 'option four', 'option 4', 'action four', 'action 4', 'choice four', 'choice 4', 'number four', 'number 4'],
};

const normalize = (text: string) => text
  .trim()
  .toLowerCase()
  .replace(/[.,!?;:]/g, '')
  .replace(/\s+/g, ' ');

export function parseSpeechIntent(transcript: string): SpeechIntent {
  const trimmed = transcript.trim();
  const normalized = normalize(trimmed);

  for (const [index, phrases] of Object.entries(CHOICE_PHRASES)) {
    if (phrases.includes(normalized)) {
      return { type: 'choice', index: Number(index) as 0 | 1 | 2 | 3, transcript: trimmed };
    }
  }

  return { type: 'custom', text: trimmed, transcript: trimmed };
}
