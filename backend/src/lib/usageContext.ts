import { AsyncLocalStorage } from 'async_hooks';

// Who a provider call is made for. Set once per authenticated request; background work
// started from that request (turn side effects, summaries, images) inherits it.
export interface UsageContext {
  namespaceId: string;
  userId: string | null;
  sessionId?: string;
}

const storage = new AsyncLocalStorage<UsageContext>();

export function runWithUsageContext<T>(context: UsageContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function getUsageContext(): UsageContext | undefined {
  return storage.getStore();
}

export function setUsageSessionId(sessionId: string): void {
  const context = storage.getStore();
  if (context) {
    context.sessionId = sessionId;
  }
}
