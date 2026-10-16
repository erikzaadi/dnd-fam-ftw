import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInstantStartWaiter } from './instantStartWait';

const never = () => Promise.resolve(false);

describe('createInstantStartWaiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('finishes when the ready event names the pending adventure, ignoring others', async () => {
    const waiter = createInstantStartWaiter();
    const done = waiter.wait('a', never);
    waiter.markReady('other');
    waiter.markReady('a');
    await expect(done).resolves.toBe('ready');
  });

  it('finishes at once when the ready event came before the adventure id was known', async () => {
    const waiter = createInstantStartWaiter();
    waiter.markReady('a');
    await expect(waiter.wait('a', never)).resolves.toBe('ready');
  });

  it('finishes from history when the event was missed', async () => {
    const waiter = createInstantStartWaiter();
    await expect(waiter.wait('a', () => Promise.resolve(true))).resolves.toBe('ready');
  });

  it('rechecks history on reconnect', async () => {
    const waiter = createInstantStartWaiter();
    let playable = false;
    const done = waiter.wait('a', () => Promise.resolve(playable));
    await Promise.resolve();
    playable = true;
    waiter.reconcile();
    await expect(done).resolves.toBe('ready');
  });

  it('stops waiting after the timeout', async () => {
    const waiter = createInstantStartWaiter();
    const done = waiter.wait('a', never, 1000);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(done).resolves.toBe('timeout');
  });

  it('cancels on leave', async () => {
    const waiter = createInstantStartWaiter();
    const done = waiter.wait('a', never);
    waiter.cancel();
    await expect(done).resolves.toBe('cancelled');
    waiter.markReady('a');
  });
});
