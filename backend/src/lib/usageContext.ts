import { AsyncLocalStorage } from 'async_hooks';

// Who a provider call is made for. Set once per authenticated request; background work
// started from that request (turn side effects, summaries, images) inherits it.
// 'verified': the namespace owner was resolved when the context was created.
// 'system': auth-disabled 'local' namespace (no owner by design).
// 'unresolved': a real namespace without a valid owner; paid provider calls are refused.
export type UsageAttribution = 'verified' | 'system' | 'unresolved';

export interface UsageContext {
  namespaceId: string;
  // The acting user.
  userId: string | null;
  // The namespace owner when the request began: responsible for its usage, including
  // background work the request started. Never changed after creation, so a later
  // ownership transfer or browser realm switch cannot retarget work already under way.
  readonly ownerUserId: string | null;
  readonly attribution: UsageAttribution;
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
