import { EventEmitter } from 'events';
import type { Request, Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { broadcastSessionListUpdate, broadcastUpdate, registerSessionEventStream, registerSessionListEventStream } from './sessionEvents.js';

const fakeStream = () => {
  const req = new EventEmitter() as unknown as Request;
  const written: string[] = [];
  const res = {
    setHeader: vi.fn(),
    write: (chunk: string) => written.push(chunk),
    end: vi.fn(),
  } as unknown as Response;
  return { req, res, written };
};

describe('live streams lose access on the next heartbeat', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('ends an adventure stream once access is gone and sends nothing after', () => {
    const { req, res, written } = fakeStream();
    let allowed = true;
    registerSessionEventStream(req, res, 'adv-1', () => allowed);

    vi.advanceTimersByTime(25_000);
    expect(written.at(-1)).toContain('heartbeat');
    expect(res.end).not.toHaveBeenCalled();

    allowed = false;
    vi.advanceTimersByTime(25_000);
    expect(res.end).toHaveBeenCalledTimes(1);

    const count = written.length;
    broadcastUpdate('adv-1', 'narration_chunk', { text: 'secret' });
    vi.advanceTimersByTime(50_000);
    expect(written).toHaveLength(count);
  });

  it('ends a realm stream once access is gone', () => {
    const { req, res, written } = fakeStream();
    let allowed = true;
    registerSessionListEventStream(req, res, 'realm-1', () => allowed);
    broadcastSessionListUpdate('realm-1', 'session_changed', { sessionId: 'a' });
    expect(written.at(-1)).toContain('session_changed');

    allowed = false;
    vi.advanceTimersByTime(25_000);
    expect(res.end).toHaveBeenCalledTimes(1);
    const count = written.length;
    broadcastSessionListUpdate('realm-1', 'session_changed', { sessionId: 'b' });
    expect(written).toHaveLength(count);
  });
});
