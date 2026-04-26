import { describe, expect, it, vi } from 'vitest';
import { createBrowserSpeechRecognitionService } from './browserSpeechRecognitionService';
import type { BrowserSpeechRecognitionLike, SpeechRecognitionEventLike } from './sttTypes';

class FakeRecognition implements BrowserSpeechRecognitionLike {
  lang = '';
  continuous = true;
  interimResults = false;
  onstart: (() => void) | null = null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((event: Event & { error?: string }) => void) | null = null;
  start = vi.fn(() => this.onstart?.());
  stop = vi.fn(() => this.onend?.());
  abort = vi.fn();
}

describe('createBrowserSpeechRecognitionService', () => {
  it('reports unsupported when no constructor is available', () => {
    const service = createBrowserSpeechRecognitionService({}, null);
    expect(service.isSupported()).toBe(false);
  });

  it('configures and starts browser recognition', () => {
    const service = createBrowserSpeechRecognitionService({}, FakeRecognition);
    service.start();
    expect(service.isSupported()).toBe(true);
  });

  it('passes final transcripts to callbacks', () => {
    const instances: FakeRecognition[] = [];
    class CapturingRecognition extends FakeRecognition {
      constructor() {
        super();
        instances.push(this);
      }
    }
    const onResult = vi.fn();
    const service = createBrowserSpeechRecognitionService({ onResult }, CapturingRecognition);
    service.start();

    instances[0].onresult?.({
      resultIndex: 0,
      results: {
        length: 1,
        0: { isFinal: true, 0: { transcript: 'open the door' } },
      },
    } as unknown as SpeechRecognitionEventLike);

    expect(onResult).toHaveBeenCalledWith('open the door', true);
  });
});
