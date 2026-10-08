import { afterEach, describe, expect, it, vi } from 'vitest';
import { speakWithRealtime, type RealtimeSocket } from './realtimeSpeech.js';

type Listener = (event: { data: unknown }) => void;

class FakeSocket implements RealtimeSocket {
  public sent: Record<string, unknown>[] = [];
  public closed = false;
  private listeners = new Map<string, Listener[]>();

  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }

  close(): void {
    this.closed = true;
  }

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  emit(type: 'open' | 'error' | 'close'): void {
    this.listeners.get(type)?.forEach(listener => listener({ data: null }));
  }

  server(event: Record<string, unknown>): void {
    this.listeners.get('message')?.forEach(listener => listener({ data: JSON.stringify(event) }));
  }
}

const pcm = (bytes: number[]) => Buffer.from(bytes).toString('base64');

function start(overrides: Partial<Parameters<typeof speakWithRealtime>[0]> = {}) {
  const socket = new FakeSocket();
  const audio: Buffer[] = [];
  const openSocket = vi.fn(() => socket);
  const result = speakWithRealtime({
    apiKey: 'test-key',
    model: 'gpt-realtime-2.1-mini',
    voice: 'ash',
    instructions: 'Speak like a storyteller.',
    text: 'The door creaks open.',
    onAudio: chunk => audio.push(chunk),
    openSocket,
    ...overrides,
  });
  return { socket, audio, openSocket, result };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('speakWithRealtime', () => {
  it('asks for audio of exactly the given text in the given voice', async () => {
    const { socket, openSocket, result } = start();
    socket.emit('open');
    socket.server({ type: 'response.done', response: { status: 'completed' } });
    await result;

    expect(openSocket).toHaveBeenCalledWith('wss://api.openai.com/v1/realtime?model=gpt-realtime-2.1-mini', 'test-key');
    expect(socket.sent.map(event => event.type)).toEqual(['session.update', 'conversation.item.create', 'response.create']);
    const session = socket.sent[0].session as { instructions: string; output_modalities: string[]; audio: { output: { voice: string; format: unknown } } };
    expect(session.instructions).toContain('nothing else');
    expect(session.instructions).toContain('Speak like a storyteller.');
    expect(session.output_modalities).toEqual(['audio']);
    expect(session.audio.output).toEqual({ voice: 'ash', format: { type: 'audio/pcm', rate: 24000 } });
    expect(socket.sent[1].item).toEqual({ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'The door creaks open.' }] });
  });

  it('streams audio chunks in order and returns the transcript and usage', async () => {
    const { socket, audio, result } = start();
    socket.emit('open');
    socket.server({ type: 'response.output_audio.delta', delta: pcm([1, 2]) });
    socket.server({ type: 'response.output_audio_transcript.delta', delta: 'The door ' });
    socket.server({ type: 'response.output_audio.delta', delta: pcm([3, 4]) });
    socket.server({ type: 'response.output_audio_transcript.delta', delta: 'creaks open.' });
    socket.server({
      type: 'response.done',
      response: {
        status: 'completed',
        usage: { input_tokens: 156, output_tokens: 455, input_token_details: { text_tokens: 156 }, output_token_details: { text_tokens: 129, audio_tokens: 326 } },
      },
    });

    await expect(result).resolves.toEqual({
      transcript: 'The door creaks open.',
      usage: { inputTokens: 156, outputTokens: 455, textInputTokens: 156, textOutputTokens: 129, audioOutputTokens: 326 },
    });
    expect(Buffer.concat(audio)).toEqual(Buffer.from([1, 2, 3, 4]));
    expect(socket.closed).toBe(true);
  });

  it('fails when the provider reports an error', async () => {
    const { socket, result } = start();
    socket.emit('open');
    socket.server({ type: 'error', error: { message: 'Invalid voice' } });

    await expect(result).rejects.toThrow('Invalid voice');
    expect(socket.closed).toBe(true);
  });

  it('fails, keeping the reported usage, when the response does not complete', async () => {
    const { socket, result } = start();
    socket.emit('open');
    socket.server({ type: 'response.done', response: { status: 'incomplete', usage: { input_tokens: 10, output_tokens: 20 } } });

    await expect(result).rejects.toMatchObject({ message: expect.stringContaining('incomplete'), usage: { inputTokens: 10, outputTokens: 20 } });
  });

  it('fails when the connection closes before the narration finishes', async () => {
    const { socket, result } = start();
    socket.emit('open');
    socket.emit('close');

    await expect(result).rejects.toThrow('closed before');
  });

  it('fails when the connection cannot be made', async () => {
    const { socket, result } = start();
    socket.emit('error');

    await expect(result).rejects.toThrow('connection failed');
  });

  it('fails and closes the session after the timeout', async () => {
    vi.useFakeTimers();
    const { socket, result } = start({ timeoutMs: 5000 });
    socket.emit('open');
    const outcome = expect(result).rejects.toThrow('timed out');

    await vi.advanceTimersByTimeAsync(5000);

    await outcome;
    expect(socket.closed).toBe(true);
  });

  it('stops and ignores later audio when the caller cancels', async () => {
    const controller = new AbortController();
    const { socket, audio, result } = start({ signal: controller.signal });
    socket.emit('open');
    controller.abort();
    socket.server({ type: 'response.output_audio.delta', delta: pcm([9, 9]) });

    await expect(result).rejects.toThrow('cancelled');
    expect(socket.closed).toBe(true);
    expect(audio).toEqual([]);
  });

  it('never opens a session for a request that is already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const { openSocket, result } = start({ signal: controller.signal });

    await expect(result).rejects.toThrow('cancelled');
    expect(openSocket).not.toHaveBeenCalled();
  });
});
