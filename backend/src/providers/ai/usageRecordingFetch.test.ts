import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usageRepository } from '../../repositories/usageRepository.js';
import { runWithUsageContext } from '../../lib/usageContext.js';
import { createUsageRecordingFetch, extractUsage } from './usageRecordingFetch.js';

vi.mock('../../repositories/usageRepository.js', () => ({
  usageRepository: { recordProviderUsage: vi.fn() },
}));

vi.mock('../../services/usageLimitService.js', () => ({
  checkProviderAdmission: vi.fn(() => null),
}));

const allowAll = () => null;

const recorded = () => vi.mocked(usageRepository.recordProviderUsage).mock.calls.map(call => call[0]);
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createUsageRecordingFetch', () => {
  it('records chat usage attributed to the current usage context', async () => {
    const recordingFetch = createUsageRecordingFetch(async () => jsonResponse({ usage: { prompt_tokens: 1000, completion_tokens: 500 } }), allowAll);
    await runWithUsageContext({ namespaceId: 'ns-1', userId: 'user-1', ownerUserId: 'owner-1', attribution: 'verified', sessionId: 'session-1' }, () =>
      recordingFetch('https://api.openai.com/v1/chat/completions', { method: 'POST', body: JSON.stringify({ model: 'gpt-4.1-mini' }) }));
    await flush();
    expect(recorded()).toEqual([expect.objectContaining({
      namespaceId: 'ns-1',
      userId: 'user-1',
      ownerUserId: 'owner-1',
      attribution: 'verified',
      sessionId: 'session-1',
      kind: 'text',
      endpoint: '/chat/completions',
      model: 'gpt-4.1-mini',
      inputTokens: 1000,
      outputTokens: 500,
      success: true,
    })]);
    expect(recorded()[0].estimatedCostUsd).toBeCloseTo((1000 * 0.4 + 500 * 1.6) / 1_000_000);
  });

  it('records work outside a request with a null namespace', async () => {
    const recordingFetch = createUsageRecordingFetch(async () => jsonResponse({}), allowAll);
    await recordingFetch('https://api.openai.com/v1/images/generations', { method: 'POST', body: JSON.stringify({ model: 'gpt-image-2' }) });
    await flush();
    expect(recorded()[0]).toMatchObject({ namespaceId: null, ownerUserId: null, attribution: 'system', kind: 'image', imageCount: 1 });
  });

  it('refuses paid calls for a realm without a valid owner, without recording', async () => {
    const baseFetch = vi.fn(async () => jsonResponse({}));
    const recordingFetch = createUsageRecordingFetch(baseFetch, allowAll);
    const response = await runWithUsageContext({ namespaceId: 'ns-orphan', userId: 'user-1', ownerUserId: null, attribution: 'unresolved' }, () =>
      recordingFetch('https://api.openai.com/v1/chat/completions', { method: 'POST', body: '{}' }));
    expect(response.status).toBe(403);
    expect(response.headers.get('x-should-retry')).toBe('false');
    expect(baseFetch).not.toHaveBeenCalled();
    expect(recorded()).toEqual([]);
  });

  it('keeps the owner from dispatch time for a stream that finishes later', async () => {
    const encoder = new TextEncoder();
    let finish: () => void = () => undefined;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"usage":{"prompt_tokens":3,"completion_tokens":4}}\n\n'));
        finish = () => {
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        };
      },
    });
    const recordingFetch = createUsageRecordingFetch(async () => new Response(body, { headers: { 'content-type': 'text/event-stream' } }), allowAll);
    const context = { namespaceId: 'ns-r', userId: 'user-b', ownerUserId: 'owner-a', attribution: 'verified' as const, sessionId: 'session-r' };
    const response = await runWithUsageContext(context, () =>
      recordingFetch('https://api.openai.com/v1/chat/completions', { method: 'POST', body: JSON.stringify({ stream: true }) }));
    // The session id changing after dispatch does not rewrite this attempt's attribution.
    context.sessionId = 'session-other';
    finish();
    await response.text();
    await flush();
    expect(recorded()[0]).toMatchObject({ namespaceId: 'ns-r', userId: 'user-b', ownerUserId: 'owner-a', sessionId: 'session-r' });
  });

  it('records failed provider responses without cost', async () => {
    const recordingFetch = createUsageRecordingFetch(async () => jsonResponse({ error: 'rate limited' }, 429), allowAll);
    const response = await recordingFetch('https://api.openai.com/v1/images/generations', { method: 'POST', body: '{}' });
    expect(response.status).toBe(429);
    expect(recorded()[0]).toMatchObject({ success: false, estimatedCostUsd: 0 });
  });

  it('records TTS characters from the request input', async () => {
    const recordingFetch = createUsageRecordingFetch(async () => new Response('audio', { headers: { 'content-type': 'audio/mpeg' } }), allowAll);
    await recordingFetch('https://api.openai.com/v1/audio/speech', { method: 'POST', body: JSON.stringify({ model: 'gpt-4o-mini-tts', input: 'Hello realm' }) });
    expect(recorded()[0]).toMatchObject({ kind: 'tts', ttsCharacters: 11 });
  });

  it('passes a stream through unchanged and records usage from its last event', async () => {
    const events = [
      'data: {"choices":[{"delta":{"content":"Hi"}}],"usage":null}\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":2}}\n\n',
      'data: [DONE]\n\n',
    ];
    const recordingFetch = createUsageRecordingFetch(async () => new Response(events.join(''), { headers: { 'content-type': 'text/event-stream' } }), allowAll);
    const response = await recordingFetch('https://api.openai.com/v1/chat/completions', { method: 'POST', body: JSON.stringify({ model: 'gpt-4.1', stream: true }) });
    expect(await response.text()).toBe(events.join(''));
    await flush();
    expect(recorded()[0]).toMatchObject({ inputTokens: 10, outputTokens: 2, success: true });
  });

  it('refuses over-limit requests without calling the provider or recording usage', async () => {
    const baseFetch = vi.fn(async () => jsonResponse({}));
    const recordingFetch = createUsageRecordingFetch(baseFetch, () => ({
      error: 'limit_reached', kind: 'pictures', tier: 'free', message: 'Painters resting', resetsAt: null,
    }));
    const response = await recordingFetch('https://api.openai.com/v1/images/generations', { method: 'POST', body: '{}' });
    expect(response.status).toBe(429);
    expect(response.headers.get('x-should-retry')).toBe('false');
    expect(baseFetch).not.toHaveBeenCalled();
    expect(recorded()).toEqual([]);
  });

  it('does not record non-billable endpoints', async () => {
    const recordingFetch = createUsageRecordingFetch(async () => jsonResponse({ data: [] }), allowAll);
    await recordingFetch('https://api.openai.com/v1/models');
    await flush();
    expect(recorded()).toEqual([]);
  });
});

describe('extractUsage', () => {
  it('reads Responses/Images token names', () => {
    expect(extractUsage({ usage: { input_tokens: 3, output_tokens: 4 } })).toEqual({ inputTokens: 3, outputTokens: 4 });
  });
});
