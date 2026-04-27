import { apiFetch } from '../lib/api';

const TTS_CACHE_MAX_BYTES = 10 * 1024 * 1024;
const TTS_REQUEST_TIMEOUT_MS = 15000;

type OpenAiTtsInput = {
  text: string;
  gender?: 'male' | 'female';
  turnId?: number | string;
  volume?: number;
};

type CacheEntry = {
  url: string;
  bytes: number;
};

function cacheKey(turnId: number | string, gender?: 'male' | 'female') {
  return `${turnId}:${gender ?? 'male'}`;
}

class OpenAiTtsService {
  private currentAudio: HTMLAudioElement | null = null;
  private currentResolve: (() => void) | null = null;
  private _speaking = false;
  private cache = new Map<string, CacheEntry>();
  private cacheTotalBytes = 0;

  public isSupported(): boolean {
    return typeof window !== 'undefined' && typeof Audio !== 'undefined' && typeof URL !== 'undefined';
  }

  public isSpeaking(): boolean {
    return this._speaking;
  }

  public async speakNarration({ text, gender, turnId, volume = 1 }: OpenAiTtsInput): Promise<void> {
    if (!this.isSupported()) {
      return;
    }

    this.stop();

    const key = turnId === undefined ? null : cacheKey(turnId, gender);
    const cached = key ? this.cache.get(key) : null;
    if (cached && key) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      await this.playUrl(cached.url, volume);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), TTS_REQUEST_TIMEOUT_MS);
    try {
      const response = await apiFetch('/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, gender }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`OpenAI TTS failed with ${response.status}`);
      }

      const audioBuffer = await response.arrayBuffer();
      const bytes = audioBuffer.byteLength;
      const blob = new Blob([audioBuffer], { type: 'audio/mpeg' });
      const url = URL.createObjectURL(blob);

      await this.playUrl(url, volume);

      if (key) {
        this.storeCacheEntry(key, { url, bytes });
      } else {
        URL.revokeObjectURL(url);
      }
    } finally {
      window.clearTimeout(timeout);
    }
  }

  public stop(): void {
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.currentTime = 0;
      this.currentAudio = null;
    }
    if (this.currentResolve) {
      this.currentResolve();
      this.currentResolve = null;
    }
    this._speaking = false;
  }

  public clearCache(): void {
    for (const entry of this.cache.values()) {
      URL.revokeObjectURL(entry.url);
    }
    this.cache.clear();
    this.cacheTotalBytes = 0;
  }

  private storeCacheEntry(key: string, entry: CacheEntry): void {
    const existing = this.cache.get(key);
    if (existing) {
      URL.revokeObjectURL(existing.url);
      this.cacheTotalBytes -= existing.bytes;
      this.cache.delete(key);
    }

    while (this.cacheTotalBytes + entry.bytes > TTS_CACHE_MAX_BYTES && this.cache.size > 0) {
      const oldestKey = this.cache.keys().next().value as string | undefined;
      if (!oldestKey) {
        break;
      }
      const oldest = this.cache.get(oldestKey);
      if (oldest) {
        URL.revokeObjectURL(oldest.url);
        this.cacheTotalBytes -= oldest.bytes;
      }
      this.cache.delete(oldestKey);
    }

    if (entry.bytes <= TTS_CACHE_MAX_BYTES) {
      this.cache.set(key, entry);
      this.cacheTotalBytes += entry.bytes;
    } else {
      URL.revokeObjectURL(entry.url);
    }
  }

  private playUrl(url: string, volume: number): Promise<void> {
    return new Promise(resolve => {
      const audio = new Audio(url);
      this.currentAudio = audio;
      this._speaking = true;
      audio.volume = Math.max(0, Math.min(1, volume));

      const finish = () => {
        if (this.currentAudio === audio) {
          this.currentAudio = null;
          this._speaking = false;
        }
        if (this.currentResolve === finish) {
          this.currentResolve = null;
        }
        resolve();
      };

      this.currentResolve = finish;
      audio.onended = finish;
      audio.onerror = finish;

      audio.play().catch(finish);
    });
  }
}

export const openAiTtsService = new OpenAiTtsService();
