// Text-to-speech through the OpenAI Realtime API. OpenAI retires the
// /audio/speech models on 2027-01-06 and names a Realtime model as the
// replacement, so one narration is one short WebSocket session: text in,
// PCM16 audio and a transcript of what was spoken out.

export const REALTIME_SPEECH_URL = 'wss://api.openai.com/v1/realtime';

// A Realtime model converses by default. Narration must be the text and nothing else.
const VERBATIM_INSTRUCTIONS = 'You are a text-to-speech reader, not a conversational assistant. The user message is a script. Your entire spoken output must be that script and nothing else: your first spoken word is the first word of the script and your last spoken word is its last word. Never announce, acknowledge, greet, reply, comment, summarize, add, omit, or reorder anything.';

const DEFAULT_TIMEOUT_MS = 30_000;

export interface RealtimeSpeechUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  textInputTokens: number | null;
  textOutputTokens: number | null;
  audioOutputTokens: number | null;
}

export interface RealtimeSpeechRequest {
  apiKey: string;
  model: string;
  voice: string;
  // How to speak (narrator character). The read-it-verbatim rule is added here.
  instructions: string;
  text: string;
  // Called with each PCM16 mono 24 kHz chunk as it arrives.
  onAudio: (pcm: Buffer) => void;
  signal?: AbortSignal;
  timeoutMs?: number;
  // Test seam: production opens a real WebSocket.
  openSocket?: (url: string, apiKey: string) => RealtimeSocket;
}

export interface RealtimeSpeechResult {
  // What the model says it spoke. Compare with the text before trusting the audio.
  transcript: string;
  usage: RealtimeSpeechUsage | null;
}

// The part of the WebSocket interface this module uses.
export interface RealtimeSocket {
  send(data: string): void;
  close(): void;
  addEventListener(type: 'open', listener: () => void): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  addEventListener(type: 'error', listener: () => void): void;
  addEventListener(type: 'close', listener: () => void): void;
}

// The key travels in the WebSocket subprotocol header over TLS, the same way the
// OpenAI SDK's own WebSocket client authenticates.
function openRealtimeSocket(url: string, apiKey: string): RealtimeSocket {
  return new WebSocket(url, ['realtime', `openai-insecure-api-key.${apiKey}`]);
}

const tokenCount = (value: unknown): number | null => (typeof value === 'number' ? value : null);

function readUsage(usage: unknown): RealtimeSpeechUsage | null {
  if (!usage || typeof usage !== 'object') {
    return null;
  }
  const record = usage as Record<string, unknown>;
  const input = (record.input_token_details ?? {}) as Record<string, unknown>;
  const output = (record.output_token_details ?? {}) as Record<string, unknown>;
  return {
    inputTokens: tokenCount(record.input_tokens),
    outputTokens: tokenCount(record.output_tokens),
    textInputTokens: tokenCount(input.text_tokens),
    textOutputTokens: tokenCount(output.text_tokens),
    audioOutputTokens: tokenCount(output.audio_tokens),
  };
}

export class RealtimeSpeechError extends Error {
  // Usage reported before the failure, if any: a failed narration can still be billed.
  constructor(message: string, public readonly usage: RealtimeSpeechUsage | null = null) {
    super(message);
    this.name = 'RealtimeSpeechError';
  }
}

export function speakWithRealtime(request: RealtimeSpeechRequest): Promise<RealtimeSpeechResult> {
  const { apiKey, model, voice, instructions, text, onAudio, signal, timeoutMs = DEFAULT_TIMEOUT_MS, openSocket = openRealtimeSocket } = request;

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new RealtimeSpeechError('Realtime speech was cancelled'));
      return;
    }

    let transcript = '';
    let settled = false;
    const socket = openSocket(`${REALTIME_SPEECH_URL}?model=${encodeURIComponent(model)}`, apiKey);

    const settle = (finish: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      try {
        socket.close();
      } catch {
        // Already closed.
      }
      finish();
    };
    const fail = (message: string, usage: RealtimeSpeechUsage | null = null) => settle(() => reject(new RealtimeSpeechError(message, usage)));
    const onAbort = () => fail('Realtime speech was cancelled');
    const timer = setTimeout(() => fail(`Realtime speech timed out after ${timeoutMs}ms`), timeoutMs);
    signal?.addEventListener('abort', onAbort);

    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({
        type: 'session.update',
        session: {
          type: 'realtime',
          model,
          instructions: `${VERBATIM_INSTRUCTIONS} ${instructions}`,
          output_modalities: ['audio'],
          audio: { output: { voice, format: { type: 'audio/pcm', rate: 24000 } } },
        },
      }));
      socket.send(JSON.stringify({
        type: 'conversation.item.create',
        item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] },
      }));
      socket.send(JSON.stringify({ type: 'response.create' }));
    });

    socket.addEventListener('message', message => {
      let event: { type?: string; delta?: unknown; response?: { status?: string; usage?: unknown }; error?: { message?: string } };
      try {
        event = JSON.parse(String(message.data));
      } catch {
        return;
      }
      switch (event.type) {
      case 'response.output_audio.delta':
        if (typeof event.delta === 'string' && !settled) {
          onAudio(Buffer.from(event.delta, 'base64'));
        }
        break;
      case 'response.output_audio_transcript.delta':
        if (typeof event.delta === 'string') {
          transcript += event.delta;
        }
        break;
      case 'response.done': {
        const usage = readUsage(event.response?.usage);
        if (event.response?.status === 'completed') {
          settle(() => resolve({ transcript, usage }));
        } else {
          fail(`Realtime speech ended with status "${event.response?.status ?? 'unknown'}"`, usage);
        }
        break;
      }
      case 'error':
        fail(`Realtime speech failed: ${event.error?.message ?? 'unknown error'}`);
        break;
      default:
        break;
      }
    });

    socket.addEventListener('error', () => fail('Realtime speech connection failed'));
    socket.addEventListener('close', () => fail('Realtime speech connection closed before the narration finished'));
  });
}
