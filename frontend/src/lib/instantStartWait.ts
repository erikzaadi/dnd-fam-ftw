// Waits until a new instant-start adventure is playable. The backend announces it with
// instant_start_ready on the realm stream (after the first turn, or after it failed), but
// that event can arrive before the POST response names the adventure, or be missed while
// the stream reconnects. So: remember ready ids, reconcile with history on start and on
// every reconnect, and stop waiting after a timeout either way.
export type InstantStartWaitResult = 'ready' | 'timeout' | 'cancelled';

export const INSTANT_START_TIMEOUT_MS = 90_000;

export const createInstantStartWaiter = () => {
  const readyIds = new Set<string>();
  let pending: { id: string; isReady: () => Promise<boolean>; finish: (result: InstantStartWaitResult) => void } | null = null;

  const check = (current: NonNullable<typeof pending>) => {
    void current.isReady().then(ready => {
      if (ready) {
        current.finish('ready');
      }
    }, () => {});
  };

  return {
    // From the realm stream: instant_start_ready for any adventure.
    markReady(id: string): void {
      readyIds.add(id);
      if (pending?.id === id) {
        pending.finish('ready');
      }
    },
    // From the realm stream reconnecting: the event may have been missed meanwhile.
    reconcile(): void {
      if (pending) {
        check(pending);
      }
    },
    wait(id: string, isReady: () => Promise<boolean>, timeoutMs: number = INSTANT_START_TIMEOUT_MS): Promise<InstantStartWaitResult> {
      pending?.finish('cancelled');
      return new Promise(resolve => {
        const current = {
          id,
          isReady,
          finish: (result: InstantStartWaitResult) => {
            clearTimeout(timer);
            if (pending === current) {
              pending = null;
            }
            resolve(result);
          },
        };
        pending = current;
        const timer = setTimeout(() => current.finish('timeout'), timeoutMs);
        if (readyIds.has(id)) {
          current.finish('ready');
          return;
        }
        check(current);
      });
    },
    cancel(): void {
      pending?.finish('cancelled');
    },
  };
};
