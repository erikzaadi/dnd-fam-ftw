import type { BrowserVoiceInfo, TtsSettings } from './ttsTypes';
import { genderNameHints, stylePresets } from './ttsVoiceCatalog';

const isDev = import.meta.env.DEV;

function log(...args: unknown[]) {
  if (isDev) {
    console.log('[TTS]', ...args);
  }
}

function normalizeNarrationForSpeech(text: string): string {
  return text
    .replace(/#{1,6}\s+/g, '')       // strip markdown headers
    .replace(/\*\*(.+?)\*\*/g, '$1') // strip bold
    .replace(/\*(.+?)\*/g, '$1')     // strip italic
    .replace(/_(.+?)_/g, '$1')       // strip underscore italic
    .replace(/`(.+?)`/g, '$1')       // strip inline code
    .replace(/\[(.+?)\]\(.+?\)/g, '$1') // strip links, keep label
    .replace(/\s{2,}/g, ' ')         // collapse multiple spaces
    .trim();
}

function selectBestVoice(
  voices: SpeechSynthesisVoice[],
  settings: TtsSettings
): SpeechSynthesisVoice | null {
  if (voices.length === 0) {
    return null;
  }

  // 1. Exact URI match
  if (settings.preferredVoiceURI) {
    const exact = voices.find(v => v.voiceURI === settings.preferredVoiceURI);
    if (exact) {
      log('Using exact voice URI:', exact.name);
      return exact;
    }
    log('Preferred voice URI not found, falling back');
  }

  // 2. Exact name match
  if (settings.preferredVoiceName) {
    const byName = voices.find(v => v.name === settings.preferredVoiceName);
    if (byName) {
      log('Using exact voice name:', byName.name);
      return byName;
    }
  }

  // 3. Language match
  const langPool = settings.preferredLang
    ? voices.filter(v => v.lang.startsWith(settings.preferredLang!))
    : voices;
  const pool = langPool.length > 0 ? langPool : voices;

  // 4. Gender hint match within pool
  if (settings.preferredGenderHint !== 'any') {
    const hints = genderNameHints[settings.preferredGenderHint];
    const byGender = pool.find(v =>
      hints.some(h => v.name.toLowerCase().includes(h.toLowerCase()))
    );
    if (byGender) {
      log('Using gender-hinted voice:', byGender.name, `(hint: ${settings.preferredGenderHint})`);
      return byGender;
    }
  }

  // 5. Browser default within pool
  const defaultVoice = pool.find(v => v.default);
  if (defaultVoice) {
    log('Using browser default voice:', defaultVoice.name);
    return defaultVoice;
  }

  // 6. First available
  log('Using first available voice:', pool[0].name);
  return pool[0];
}

class BrowserTtsService {
  public isSupported(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window;
  }

  public isSpeaking(): boolean {
    return this.isSupported() && window.speechSynthesis.speaking;
  }

  public getAvailableVoices(): BrowserVoiceInfo[] {
    if (!this.isSupported()) {
      return [];
    }
    return window.speechSynthesis.getVoices().map(v => ({
      name: v.name,
      lang: v.lang,
      voiceURI: v.voiceURI,
      localService: v.localService,
      default: v.default,
    }));
  }

  public speakNarration(text: string, settings: TtsSettings): Promise<void> {
    return new Promise(resolve => {
      if (!this.isSupported() || !settings.enabled) {
        resolve();
        return;
      }

      const cleaned = normalizeNarrationForSpeech(text);
      if (!cleaned) {
        resolve();
        return;
      }

      // Cancel any currently playing narration before starting new one
      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(cleaned);

      const preset = stylePresets[settings.preferredStyle];
      utterance.volume = settings.volume;
      utterance.rate = settings.rate * preset.rate;
      utterance.pitch = settings.pitch * preset.pitch;

      const voices = window.speechSynthesis.getVoices();
      const selectedVoice = selectBestVoice(voices, settings);
      if (selectedVoice) {
        utterance.voice = selectedVoice;
        utterance.lang = selectedVoice.lang;
      }

      utterance.onstart = () => log('Speech started');
      utterance.onend = () => {
        log('Speech ended');
        resolve();
      };
      utterance.onerror = (e) => {
        // 'interrupted' and 'canceled' are expected when cancel() is called before
        // starting a new utterance or when stop() is called explicitly. Not real errors.
        if (e.error === 'interrupted' || e.error === 'canceled') {
          resolve();
          return;
        }
        if (isDev) {
          console.warn('[TTS] Speech error:', e.error);
        }
        resolve();
      };

      try {
        window.speechSynthesis.speak(utterance);
        log('Speaking narration, voice:', selectedVoice?.name ?? 'browser default');
      } catch (e) {
        if (isDev) {
          console.warn('[TTS] speak() failed:', e);
        }
        resolve();
      }
    });
  }

  public stop(): void {
    if (!this.isSupported()) {
      return;
    }
    window.speechSynthesis.cancel();
  }

  public pause(): void {
    if (!this.isSupported()) {
      return;
    }
    window.speechSynthesis.pause();
  }

  public resume(): void {
    if (!this.isSupported()) {
      return;
    }
    window.speechSynthesis.resume();
  }
}

export const browserTtsService = new BrowserTtsService();
