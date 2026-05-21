import type { OpenAiTtsVoice } from '../types';
import { OPENAI_TTS_DEFAULT_VOICE } from '../types';

export type TtsStyle = 'neutral' | 'heroic' | 'mysterious' | 'playful';
export type TtsGenderHint = 'any' | 'female' | 'male';
export type TtsProvider = 'browser' | 'openai';

export type TtsSettings = {
  enabled: boolean;
  autoSpeakNarration: boolean;
  provider: TtsProvider;
  volume: number;     // 0..1
  rate: number;       // 0.7..1.4
  pitch: number;      // 0.5..1.5
  preferredVoiceURI: string | null;
  preferredVoiceName: string | null;
  preferredLang: string | null;
  preferredStyle: TtsStyle;
  browserGenderHint: TtsGenderHint;
  openAiVoice: OpenAiTtsVoice;
};

export { OPENAI_TTS_DEFAULT_VOICE };
export type { OpenAiTtsVoice };

export type BrowserVoiceInfo = {
  name: string;
  lang: string;
  voiceURI: string;
  localService: boolean;
  default: boolean;
};
