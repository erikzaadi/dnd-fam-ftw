import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openEventStream } from './eventStream';

class FakeEventSource {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();
}

let sources: FakeEventSource[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  sources = [];
  vi.stubGlobal('EventSource', vi.fn(function () {
    const source = new FakeEventSource();
    sources.push(source);
    return source;
  }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const failOnce = async () => {
  sources.at(-1)!.onerror?.();
  await vi.advanceTimersByTimeAsync(3000);
};

describe('openEventStream', () => {
  it('reconnects after an error and passes messages through', async () => {
    const onMessage = vi.fn();
    openEventStream({ path: '/x', onMessage });
    await failOnce();
    expect(sources).toHaveLength(2);
    sources[1].onmessage?.({ data: '{"type":"connected"}' } as MessageEvent);
    expect(onMessage).toHaveBeenCalledWith('{"type":"connected"}');
  });

  it('stops for good when the caller says the resource is gone', async () => {
    const onStateChange = vi.fn();
    const onRepeatedFailure = vi.fn().mockResolvedValue('stop');
    openEventStream({ path: '/x', onMessage: vi.fn(), onStateChange, onRepeatedFailure });
    await failOnce();
    await failOnce();
    sources.at(-1)!.onerror?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(onRepeatedFailure).toHaveBeenCalledOnce();
    expect(onStateChange).toHaveBeenLastCalledWith('disconnected');
    const count = sources.length;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(sources).toHaveLength(count);
  });

  it('keeps retrying when the check says retry (network or server trouble)', async () => {
    const onRepeatedFailure = vi.fn().mockResolvedValue('retry');
    openEventStream({ path: '/x', onMessage: vi.fn(), onRepeatedFailure });
    for (let i = 0; i < 3; i++) {
      await failOnce();
    }
    expect(sources.length).toBe(4);
  });

  it('cleanup stops reconnects and ignores a probe that settles later', async () => {
    let settle: (value: 'retry' | 'stop') => void = () => {};
    const onRepeatedFailure = vi.fn(() => new Promise<'retry' | 'stop'>(resolve => {
      settle = resolve;
    }));
    const close = openEventStream({ path: '/x', onMessage: vi.fn(), onRepeatedFailure });
    await failOnce();
    await failOnce();
    sources.at(-1)!.onerror?.();
    close();
    settle('retry');
    await vi.advanceTimersByTimeAsync(120_000);
    expect(sources).toHaveLength(3);
  });
});
