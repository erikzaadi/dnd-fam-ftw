export type SpeechIntent =
  | { type: 'choice'; index: 0 | 1 | 2 | 3; transcript: string }
  | { type: 'confirm'; transcript: string }
  | { type: 'cancel'; transcript: string }
  | { type: 'retry'; transcript: string }
  | { type: 'repeat'; transcript: string }
  | { type: 'story-repeat'; transcript: string }
  | { type: 'options'; transcript: string }
  | { type: 'pause'; transcript: string }
  | { type: 'resume'; transcript: string }
  | { type: 'help'; transcript: string }
  | { type: 'status'; transcript: string }
  | { type: 'party'; transcript: string }
  | { type: 'gear'; transcript: string }
  | { type: 'where-are-we'; transcript: string }
  | { type: 'custom'; text: string; transcript: string };

const CHOICE_PHRASES: Record<0 | 1 | 2 | 3, string[]> = {
  0: ['1', 'one', 'first', 'option one', 'option 1', 'action one', 'action 1', 'choice one', 'choice 1', 'number one', 'number 1'],
  1: ['2', 'two', 'second', 'option two', 'option 2', 'action two', 'action 2', 'choice two', 'choice 2', 'number two', 'number 2'],
  2: ['3', 'three', 'third', 'option three', 'option 3', 'action three', 'action 3', 'choice three', 'choice 3', 'number three', 'number 3'],
  3: ['4', 'four', 'fourth', 'option four', 'option 4', 'action four', 'action 4', 'choice four', 'choice 4', 'number four', 'number 4'],
};

const COMMAND_PHRASES: Record<Exclude<SpeechIntent['type'], 'choice' | 'custom'>, string[]> = {
  confirm: ['confirm', 'yes', 'accept', 'submit', 'do it', 'confirm action', 'yes please', 'yep', 'yeah'],
  cancel: ['cancel', 'no', 'abort', 'go back', 'cancel action', 'no thanks', 'nope', 'nay'],
  retry: ['retry', 'try again', 'change', 'retry action', 'retry option', 'try once more', 'try again option'],
  repeat: ['repeat', 'say again', 'repeat choices', 'repeat prompt', 'repeat options'],
  'story-repeat': ['repeat story', 'repeat narration', 'story', 'repeat details', 'repeat last narration'],
  options: ['options', 'say options', 'what are the options', 'read choices', 'read options', 'choice list'],
  pause: ['pause', 'pause game', 'stop', 'pause play', 'hold'],
  resume: ['resume', 'continue', 'play', 'resume game', 'start again'],
  help: ['help', 'what can i say', 'commands', 'voice commands', 'show help'],
  status: ['status', 'info', 'state', 'how is it going', 'game status', 'current status'],
  party: ['party', 'party status', 'members', 'party health', 'party members'],
  gear: ['gear', 'inventory', 'items', 'bag', 'my gear', 'show items'],
  'where-are-we': ['where are we', 'location', 'scene', 'where am i', 'current location', 'recap location'],
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

  for (const [type, phrases] of Object.entries(COMMAND_PHRASES)) {
    if (phrases.includes(normalized)) {
      return { type: type as Exclude<SpeechIntent['type'], 'choice' | 'custom'>, transcript: trimmed };
    }
  }

  return { type: 'custom', text: trimmed, transcript: trimmed };
}
