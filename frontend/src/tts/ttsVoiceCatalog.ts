import type { TtsStyle } from './ttsTypes';

export type StylePreset = { rate: number; pitch: number };

export const stylePresets: Record<TtsStyle, StylePreset> = {
  neutral:    { rate: 0.95, pitch: 1.00 },
  heroic:     { rate: 0.92, pitch: 0.95 },
  mysterious: { rate: 0.85, pitch: 0.90 },
  playful:    { rate: 1.02, pitch: 1.08 },
};

// Heuristic name hints - gender is not reliably exposed by browser APIs.
// These are best-effort matches for common system voice names.
export const genderNameHints: { female: string[]; male: string[] } = {
  female: [
    'Samantha', 'Victoria', 'Karen', 'Moira', 'Tessa', 'Veena',
    'Google UK English Female', 'Google US English', 'Zira',
    'Microsoft Zira', 'Microsoft Hazel', 'Alice', 'Amelie', 'Anna',
    'Joana', 'Ioana', 'Monica', 'Paulina', 'Satu', 'Fiona', 'Nora',
  ],
  male: [
    'Daniel', 'Alex', 'Tom', 'Fred', 'Junior', 'Albert',
    'Google UK English Male', 'David', 'Mark', 'James',
    'Microsoft David', 'Microsoft Mark', 'Diego', 'Jorge', 'Juan',
    'Luca', 'Maged', 'Yuri',
  ],
};

export const TEST_VOICE_SAMPLE = 'The wizard raises a glowing staff as the adventure begins.';
