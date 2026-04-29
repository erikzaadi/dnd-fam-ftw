import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createBrowserSpeechRecognitionService, getSpeechRecognitionCtor } from './browserSpeechRecognitionService';
import type { BrowserSpeechRecognitionConstructor, BrowserSpeechRecognitionService, SpeechInputState } from './sttTypes';

type UseSpeechRecognitionOptions = {
  onConfirmTranscript: (text: string) => Promise<void> | void;
  createService?: typeof createBrowserSpeechRecognitionService;
  recognitionCtor?: BrowserSpeechRecognitionConstructor | null;
};

export function useSpeechRecognition({
  onConfirmTranscript,
  createService = createBrowserSpeechRecognitionService,
  recognitionCtor,
}: UseSpeechRecognitionOptions) {
  const ctor = useMemo(() => recognitionCtor === undefined ? getSpeechRecognitionCtor() : recognitionCtor, [recognitionCtor]);
  const isSupported = ctor !== null;
  const [state, setState] = useState<SpeechInputState>({ status: 'idle' });
  const serviceRef = useRef<BrowserSpeechRecognitionService | null>(null);
  const transcriptRef = useRef('');
  const stateRef = useRef<SpeechInputState>({ status: 'idle' });

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const clearService = useCallback(() => {
    serviceRef.current?.abort();
    serviceRef.current = null;
    transcriptRef.current = '';
  }, []);

  const startListening = useCallback(async () => {
    if (!isSupported) {
      setState({ status: 'error', message: 'Speech input is not supported in this browser.' });
      return;
    }

    if (stateRef.current.status === 'listening' || stateRef.current.status === 'processing' || stateRef.current.status === 'confirming' || stateRef.current.status === 'submitting') {
      return;
    }

    if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(t => t.stop());
      } catch (err) {
        const denied = err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError');
        setState({
          status: 'error',
          message: denied
            ? 'Microphone access was denied. Enable it in your browser and OS settings.'
            : 'Could not access microphone. Please try again.',
        });
        return;
      }
    }

    transcriptRef.current = '';
    setState({ status: 'listening', transcript: '' });
    const startedAt = Date.now();

    const service = createService({
      onResult: (transcript, isFinal) => {
        if (serviceRef.current !== service) {
          return;
        }
        const trimmed = transcript.trim();
        if (trimmed) {
          transcriptRef.current = trimmed;
        }
        if (isFinal) {
          service.stop();
          if (trimmed) {
            setState({ status: 'confirming', transcript: trimmed });
          } else {
            setState({ status: 'processing', transcript: transcriptRef.current });
          }
          return;
        }
        setState({ status: 'listening', transcript: transcriptRef.current });
      },
      onEnd: () => {
        if (serviceRef.current !== service) {
          return;
        }
        const current = stateRef.current;
        if (current.status !== 'listening' && current.status !== 'processing') {
          return;
        }
        const transcript = transcriptRef.current.trim();
        if (transcript) {
          setState({ status: 'confirming', transcript });
        } else if (Date.now() - startedAt < 1000) {
          setState({ status: 'error', message: 'Microphone not responding - check that your browser and OS settings allow microphone access.' });
        } else {
          setState({ status: 'error', message: "Couldn't hear anything. Please try again." });
        }
      },
      onError: message => {
        if (serviceRef.current !== service) {
          return;
        }
        setState({ status: 'error', message });
      },
    }, ctor);

    serviceRef.current = service;
    service.start();
  }, [ctor, createService, isSupported]);

  const stopListening = useCallback(() => {
    serviceRef.current?.stop();
    const transcript = transcriptRef.current.trim();
    if (transcript) {
      setState({ status: 'processing', transcript });
    }
  }, []);

  const cancel = useCallback(() => {
    clearService();
    setState({ status: 'idle' });
  }, [clearService]);

  const reset = useCallback(() => {
    cancel();
  }, [cancel]);

  const retryListening = useCallback(() => {
    clearService();
    const idleState: SpeechInputState = { status: 'idle' };
    stateRef.current = idleState;
    setState(idleState);
    void startListening();
  }, [clearService, startListening]);

  const confirmTranscript = useCallback(async () => {
    const current = stateRef.current;
    if (current.status !== 'confirming') {
      return;
    }

    const transcript = current.transcript.trim();
    if (!transcript) {
      setState({ status: 'error', message: "Couldn't hear anything. Please try again." });
      return;
    }

    setState({ status: 'submitting', transcript });
    try {
      await onConfirmTranscript(transcript);
      clearService();
      setState({ status: 'idle' });
    } catch {
      setState({ status: 'error', message: "Couldn't submit that action. Please try again." });
    }
  }, [clearService, onConfirmTranscript]);

  useEffect(() => {
    return () => {
      clearService();
    };
  }, [clearService]);

  const transcript = 'transcript' in state ? state.transcript : '';
  const errorMessage = state.status === 'error' ? state.message : null;

  return {
    isSupported,
    state,
    transcript,
    errorMessage,
    startListening,
    stopListening,
    confirmTranscript,
    retryListening,
    cancel,
    reset,
  };
}
