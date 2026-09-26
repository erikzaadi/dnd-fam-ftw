import { getUsageContext, type UsageContext } from '../../lib/usageContext.js';
import { usageRepository } from '../../repositories/usageRepository.js';
import { estimateCostUsd, type UsageKind } from '../../services/usagePricing.js';
import { checkProviderAdmission } from '../../services/usageLimitService.js';
import type { LimitReachedResponse } from '../../types.js';

type Admission = (kind: UsageKind) => LimitReachedResponse | null;

type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

interface TokenUsage {
  inputTokens: number | null;
  outputTokens: number | null;
}

interface RequestInfo {
  kind: UsageKind;
  endpoint: string;
  model: string | null;
  stream: boolean;
  ttsCharacters: number | null;
  imageCount: number | null;
}

// Every OpenAI SDK request goes through this fetch, so each attempt that reaches the
// provider (SDK retries included) is recorded once, attributed to the current request's
// usage context. Recording never changes or fails the provider call.
// Admission is the usage-limit backstop: a refused request never reaches the provider
// and gets a 429 the SDK does not retry, which callers already handle as a failed call.
export function createUsageRecordingFetch(baseFetch: Fetch = fetch, admit: Admission = checkProviderAdmission): Fetch {
  return async (input, init) => {
    const info = describeRequest(input, init);
    if (!info) {
      return baseFetch(input, init);
    }

    // Attribution is fixed when the attempt is dispatched, including for a stream that
    // finishes later; each SDK retry passes through here and gets its own snapshot.
    const context = getUsageContext();
    const attribution = snapshotAttribution(context);
    if (context?.attribution === 'unresolved') {
      return new Response(JSON.stringify({ error: { message: 'This realm has no owner yet. Ask the site operator to fix it.', type: 'usage_limit', code: 'realm_owner_missing' } }), {
        status: 403,
        headers: { 'content-type': 'application/json', 'x-should-retry': 'false' },
      });
    }

    const refusal = admit(info.kind);
    if (refusal) {
      return new Response(JSON.stringify({ error: { message: refusal.message, type: 'usage_limit', code: refusal.kind } }), {
        status: 429,
        headers: { 'content-type': 'application/json', 'x-should-retry': 'false' },
      });
    }

    let response: Response;
    try {
      response = await baseFetch(input, init);
    } catch (err) {
      record(info, attribution, false, { inputTokens: null, outputTokens: null });
      throw err;
    }

    if (!response.ok) {
      record(info, attribution, false, { inputTokens: null, outputTokens: null });
      return response;
    }

    const isEventStream = info.stream || (response.headers.get('content-type') ?? '').includes('text/event-stream');
    if (isEventStream && response.body) {
      const [forCaller, forUsage] = response.body.tee();
      void readStreamUsage(forUsage).then(usage => record(info, attribution, true, usage));
      return new Response(forCaller, { status: response.status, statusText: response.statusText, headers: response.headers });
    }

    if ((response.headers.get('content-type') ?? '').includes('application/json')) {
      void response.clone().json()
        .then(json => record(info, attribution, true, extractUsage(json)))
        .catch(() => record(info, attribution, true, { inputTokens: null, outputTokens: null }));
    } else {
      record(info, attribution, true, { inputTokens: null, outputTokens: null });
    }
    return response;
  };
}

function describeRequest(input: string | URL | Request, init?: RequestInit): RequestInfo | null {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const pathname = safePathname(url);
  let kind: UsageKind | null = null;
  if (pathname.endsWith('/chat/completions') || pathname.endsWith('/responses') || pathname.endsWith('/completions')) {
    kind = 'text';
  } else if (pathname.includes('/images/')) {
    kind = 'image';
  } else if (pathname.endsWith('/audio/speech')) {
    kind = 'tts';
  }
  if (!kind) {
    return null;
  }

  const body = parseJsonBody(init?.body);
  const model = typeof body?.model === 'string' ? body.model : null;
  return {
    kind,
    endpoint: pathname.replace(/^.*\/v1\//, '/'),
    model,
    stream: body?.stream === true,
    ttsCharacters: kind === 'tts' && typeof body?.input === 'string' ? body.input.length : null,
    imageCount: kind === 'image' ? (typeof body?.n === 'number' ? body.n : 1) : null,
  };
}

function safePathname(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function parseJsonBody(body: RequestInit['body'] | undefined): Record<string, unknown> | null {
  if (typeof body !== 'string') {
    return null;
  }
  try {
    const parsed = JSON.parse(body) as unknown;
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

// Chat Completions: prompt_tokens/completion_tokens. Responses and Images:
// input_tokens/output_tokens.
export function extractUsage(json: unknown): TokenUsage {
  const usage = (json as { usage?: Record<string, unknown> } | null)?.usage;
  if (!usage || typeof usage !== 'object') {
    return { inputTokens: null, outputTokens: null };
  }
  const num = (value: unknown) => (typeof value === 'number' ? value : null);
  return {
    inputTokens: num(usage.prompt_tokens) ?? num(usage.input_tokens),
    outputTokens: num(usage.completion_tokens) ?? num(usage.output_tokens),
  };
}

// Streams report usage in their last data event (stream_options.include_usage).
async function readStreamUsage(stream: ReadableStream<Uint8Array>): Promise<TokenUsage> {
  let usage: TokenUsage = { inputTokens: null, outputTokens: null };
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const consumeLine = (line: string) => {
    if (!line.startsWith('data:') || !line.includes('"usage"')) {
      return;
    }
    try {
      const found = extractUsage(JSON.parse(line.slice(5).trim()));
      if (found.inputTokens !== null || found.outputTokens !== null) {
        usage = found;
      }
    } catch {
      // Not JSON (e.g. [DONE]).
    }
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      lines.forEach(consumeLine);
    }
    consumeLine(buffer);
  } catch {
    // Aborted or failed stream: record what was seen.
  }
  return usage;
}

interface AttributionSnapshot {
  namespaceId: string | null;
  userId: string | null;
  ownerUserId: string | null;
  sessionId: string | null;
  attribution: 'verified' | 'system';
}

// Work outside any request (scripts, startup jobs) is system usage with no owner.
function snapshotAttribution(context: UsageContext | undefined): AttributionSnapshot {
  return {
    namespaceId: context?.namespaceId ?? null,
    userId: context?.userId ?? null,
    ownerUserId: context?.ownerUserId ?? null,
    sessionId: context?.sessionId ?? null,
    attribution: context?.attribution === 'verified' ? 'verified' : 'system',
  };
}

function record(info: RequestInfo, attribution: AttributionSnapshot, success: boolean, usage: TokenUsage): void {
  try {
    usageRepository.recordProviderUsage({
      ...attribution,
      kind: info.kind,
      endpoint: info.endpoint,
      model: info.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      ttsCharacters: info.ttsCharacters,
      imageCount: info.imageCount,
      success,
      // Rejected requests are not billed by the provider.
      estimatedCostUsd: !success ? 0 : estimateCostUsd({
        kind: info.kind,
        model: info.model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        ttsCharacters: info.ttsCharacters,
        imageCount: info.imageCount,
      }),
    });
  } catch (err) {
    console.warn(`[Usage] Failed to record provider usage: ${err instanceof Error ? err.message : String(err)}`);
  }
}
