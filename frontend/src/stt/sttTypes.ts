export type SpeechInputState =
  | { status: 'idle' }
  | { status: 'listening'; transcript: string }
  | { status: 'processing'; transcript: string }
  | { status: 'confirming'; transcript: string }
  | { status: 'submitting'; transcript: string }
  | { status: 'error'; message: string };

export type SpeechRecognitionCallbacks = {
  onStart?: () => void;
  onResult?: (transcript: string, isFinal: boolean) => void;
  onEnd?: () => void;
  onError?: (error: string) => void;
};

export interface BrowserSpeechRecognitionService {
  isSupported(): boolean;
  start(): void;
  stop(): void;
  abort(): void;
}

export type SpeechRecognitionAlternativeLike = {
  transcript: string;
};

export type SpeechRecognitionResultLike = {
  isFinal: boolean;
  0: SpeechRecognitionAlternativeLike;
};

export type SpeechRecognitionResultListLike = {
  length: number;
  [index: number]: SpeechRecognitionResultLike;
};

export type SpeechRecognitionEventLike = Event & {
  resultIndex: number;
  results: SpeechRecognitionResultListLike;
};

export type SpeechRecognitionErrorEventLike = Event & {
  error?: string;
};

export type BrowserSpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};

export type BrowserSpeechRecognitionConstructor = new () => BrowserSpeechRecognitionLike;

