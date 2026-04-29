import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useSpeechRecognition } from './useSpeechRecognition';
import type { BrowserSpeechRecognitionConstructor, BrowserSpeechRecognitionService, SpeechRecognitionCallbacks } from './sttTypes';

const FakeCtor = class {} as BrowserSpeechRecognitionConstructor;

describe('useSpeechRecognition', () => {
  it('moves final transcript into confirming state', async () => {
    let callbacks: SpeechRecognitionCallbacks | null = null;
    const service: BrowserSpeechRecognitionService = {
      isSupported: () => true,
      start: vi.fn(),
      stop: vi.fn(),
      abort: vi.fn(),
    };
    const createService = vi.fn((cb: SpeechRecognitionCallbacks) => {
      callbacks = cb;
      return service;
    });

    const { result } = renderHook(() => useSpeechRecognition({
      onConfirmTranscript: vi.fn(),
      createService,
      recognitionCtor: FakeCtor,
    }));

    await act(async () => { await result.current.startListening(); });
    act(() => callbacks?.onResult?.('open the door', true));

    expect(result.current.state).toEqual({ status: 'confirming', transcript: 'open the door' });
  });

  it('confirms transcript through the injected submit callback once', async () => {
    let callbacks: SpeechRecognitionCallbacks | null = null;
    const onConfirmTranscript = vi.fn();
    const service: BrowserSpeechRecognitionService = {
      isSupported: () => true,
      start: vi.fn(),
      stop: vi.fn(),
      abort: vi.fn(),
    };

    const { result } = renderHook(() => useSpeechRecognition({
      onConfirmTranscript,
      createService: cb => {
        callbacks = cb;
        return service;
      },
      recognitionCtor: FakeCtor,
    }));

    await act(async () => { await result.current.startListening(); });
    act(() => callbacks?.onResult?.('cast shield', true));
    await act(async () => {
      await result.current.confirmTranscript();
    });

    expect(onConfirmTranscript).toHaveBeenCalledTimes(1);
    expect(onConfirmTranscript).toHaveBeenCalledWith('cast shield');
    expect(result.current.state).toEqual({ status: 'idle' });
  });

  it('re-say discards the old transcript and starts a fresh recognition session', async () => {
    let callbacks: SpeechRecognitionCallbacks | null = null;
    const start = vi.fn();
    const abort = vi.fn();

    const { result } = renderHook(() => useSpeechRecognition({
      onConfirmTranscript: vi.fn(),
      createService: cb => {
        callbacks = cb;
        return {
          isSupported: () => true,
          start,
          stop: vi.fn(),
          abort,
        };
      },
      recognitionCtor: FakeCtor,
    }));

    await act(async () => { await result.current.startListening(); });
    act(() => callbacks?.onResult?.('old action', true));
    expect(result.current.state).toEqual({ status: 'confirming', transcript: 'old action' });

    await act(async () => { result.current.retryListening(); });

    expect(abort).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(2);
    expect(result.current.state).toEqual({ status: 'listening', transcript: '' });
  });

  it('aborts recognition on unmount', async () => {
    const abort = vi.fn();
    const { result, unmount } = renderHook(() => useSpeechRecognition({
      onConfirmTranscript: vi.fn(),
      createService: () => ({
        isSupported: () => true,
        start: vi.fn(),
        stop: vi.fn(),
        abort,
      }),
      recognitionCtor: FakeCtor,
    }));

    await act(async () => { await result.current.startListening(); });
    unmount();

    expect(abort).toHaveBeenCalled();
  });
});
