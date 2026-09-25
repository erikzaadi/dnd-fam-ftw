import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usageRepository } from '../../repositories/usageRepository.js';
import { runWithUsageContext } from '../../lib/usageContext.js';
import { createUsageRecordingFetch, extractUsage } from './usageRecordingFetch.js';

vi.mock('../../repositories/usageRepository.js', () => ({
  usageRepository: { recordProviderUsage: vi.fn() },
}));

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
    const recordingFetch = createUsageRecordingFetch(async () => jsonResponse({ usage: { prompt_tokens: 1000, completion_tokens: 500 } }));
    await runWithUsageContext({ namespaceId: 'ns-1', userId: 'user-1', sessionId: 'session-1' }, () =>
      recordingFetch('https://api.openai.com/v1/chat/completions', { method: 'POST', body: JSON.stringify({ model: 'gpt-4.1-mini' }) }));
    await flush();
    expect(recorded()).toEqual([expect.objectContaining({
      namespaceId: 'ns-1',
      userId: 'user-1',
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
    const recordingFetch = createUsageRecordingFetch(async () => jsonResponse({}));
    await recordingFetch('https://api.openai.com/v1/images/generations', { method: 'POST', body: JSON.stringify({ model: 'gpt-image-2' }) });
    await flush();
    expect(recorded()[0]).toMatchObject({ namespaceId: null, kind: 'image', imageCount: 1 });
  });

  it('records failed provider responses without cost', async () => {
    const recordingFetch = createUsageRecordingFetch(async () => jsonResponse({ error: 'rate limited' }, 429));
    const response = await recordingFetch('https://api.openai.com/v1/images/generations', { method: 'POST', body: '{}' });
    expect(response.status).toBe(429);
    expect(recorded()[0]).toMatchObject({ success: false, estimatedCostUsd: 0 });
  });

  it('records TTS characters from the request input', async () => {
    const recordingFetch = createUsageRecordingFetch(async () => new Response('audio', { headers: { 'content-type': 'audio/mpeg' } }));
    await recordingFetch('https://api.openai.com/v1/audio/speech', { method: 'POST', body: JSON.stringify({ model: 'gpt-4o-mini-tts', input: 'Hello realm' }) });
    expect(recorded()[0]).toMatchObject({ kind: 'tts', ttsCharacters: 11 });
  });

  it('passes a stream through unchanged and records usage from its last event', async () => {
    const events = [
      'data: {"choices":[{"delta":{"content":"Hi"}}],"usage":null}\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":2}}\n\n',
      'data: [DONE]\n\n',
    ];
    const recordingFetch = createUsageRecordingFetch(async () => new Response(events.join(''), { headers: { 'content-type': 'text/event-stream' } }));
    const response = await recordingFetch('https://api.openai.com/v1/chat/completions', { method: 'POST', body: JSON.stringify({ model: 'gpt-4.1', stream: true }) });
    expect(await response.text()).toBe(events.join(''));
    await flush();
    expect(recorded()[0]).toMatchObject({ inputTokens: 10, outputTokens: 2, success: true });
  });

  it('does not record non-billable endpoints', async () => {
    const recordingFetch = createUsageRecordingFetch(async () => jsonResponse({ data: [] }));
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
