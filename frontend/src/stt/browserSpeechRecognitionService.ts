import type {
  BrowserSpeechRecognitionConstructor,
  BrowserSpeechRecognitionLike,
  BrowserSpeechRecognitionService,
  SpeechRecognitionCallbacks,
  SpeechRecognitionEventLike,
} from './sttTypes';

type SpeechRecognitionWindow = Window & {
  SpeechRecognition?: BrowserSpeechRecognitionConstructor;
  webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
};

export function getSpeechRecognitionCtor(): BrowserSpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const speechWindow = window as SpeechRecognitionWindow;
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null;
}

const mapSpeechError = (error?: string) => {
  if (error === 'not-allowed' || error === 'service-not-allowed') {
    return 'Microphone access was denied.';
  }
  if (error === 'no-speech') {
    return "Couldn't hear anything. Please try again.";
  }
  if (error === 'audio-capture') {
    return 'No microphone was found.';
  }
  if (error === 'network') {
    return 'Speech recognition failed because of a network issue.';
  }
  if (error === 'aborted') {
    return 'Speech input was canceled.';
  }
  return 'Speech input failed. Please try again.';
};

export function createBrowserSpeechRecognitionService(
  callbacks: SpeechRecognitionCallbacks,
  ctor: BrowserSpeechRecognitionConstructor | null = getSpeechRecognitionCtor()
): BrowserSpeechRecognitionService {
  let recognition: BrowserSpeechRecognitionLike | null = null;
  let active = false;

  const cleanup = () => {
    if (!recognition) {
      return;
    }
    recognition.onstart = null;
    recognition.onresult = null;
    recognition.onend = null;
    recognition.onerror = null;
    recognition = null;
  };

  const createRecognition = () => {
    if (!ctor) {
      return null;
    }

    const instance = new ctor();
    instance.lang = 'en-US';
    instance.continuous = false;
    instance.interimResults = true;
    instance.onstart = () => {
      active = true;
      callbacks.onStart?.();
    };
    instance.onresult = (event: SpeechRecognitionEventLike) => {
      let transcript = '';
      let isFinal = false;

      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        transcript += result[0]?.transcript ?? '';
        isFinal = isFinal || result.isFinal;
      }

      callbacks.onResult?.(transcript, isFinal);
    };
    instance.onend = () => {
      active = false;
      callbacks.onEnd?.();
    };
    instance.onerror = event => {
      callbacks.onError?.(mapSpeechError(event.error));
    };

    return instance;
  };

  return {
    isSupported() {
      return ctor !== null;
    },
    start() {
      if (!ctor || active) {
        return;
      }
      cleanup();
      recognition = createRecognition();
      recognition?.start();
    },
    stop() {
      recognition?.stop();
    },
    abort() {
      recognition?.abort();
      active = false;
      cleanup();
    },
  };
}

