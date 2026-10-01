import type { UsageAttribution } from '../lib/usageContext.js';
import type { LimitReachedResponse } from '../types.js';
import { checkTextBudget } from './usageLimitService.js';

// Paid-work admission: whether a realm may start work that spends AI budget, decided
// once where the work enters (a website route, read-aloud, an assistant tool). Each
// adapter renders the structured refusal its own way (HTTP status, MCP tool error).
//
// What stays elsewhere, on purpose:
//   - the provider backstop (checkProviderAdmission, usageRecordingFetch.ts) with its
//     looser thresholds, so work already under way can finish
//   - picture checks right before generation (sceneImageService, automatic turn images)
//   - the MCP per-grant daily counter (mcp/admission.ts): a write, not a quota check
//   - the per-adventure turn cap (turnActionInput.ts)
// Admission reads the attribution decided at the entry point (createUsageContext) and
// never resolves the owner itself.

export type PaidWorkCheck = 'owner' | 'text';

const REALM_OWNER_MISSING_MESSAGE = 'This realm is being set up. Ask the site operator to finish it, then try again.';

// The checks each kind runs at entry, in order. Moving a check or adding one changes
// what players see: name it as a behaviour change.
const POLICY = {
  // Website routes that start AI work. A realm without a valid owner gets a clear
  // refusal before the provider backstop would refuse mid-request.
  website: ['owner', 'text'],
  // Read-aloud: no early owner refusal (the backstop refuses).
  tts: ['text'],
  // Assistant (MCP) tools: no early owner refusal (the backstop refuses).
  assistant: ['text'],
} as const satisfies Record<string, readonly PaidWorkCheck[]>;

export type PaidWorkKind = keyof typeof POLICY;

export type PaidWorkRefusal =
  | LimitReachedResponse
  | { error: 'realm_owner_missing'; message: string };

export type PaidWorkAdmission = { ok: true } | { ok: false; refusal: PaidWorkRefusal };

// The realm the work is for, as the entry point's usage context sees it.
export type PaidWorkRealm = { namespaceId: string; attribution?: UsageAttribution };

export const admitPaidWork = (kind: PaidWorkKind, realm: PaidWorkRealm, now: Date = new Date()): PaidWorkAdmission => {
  for (const check of POLICY[kind]) {
    if (check === 'owner' && realm.attribution === 'unresolved') {
      return { ok: false, refusal: { error: 'realm_owner_missing', message: REALM_OWNER_MISSING_MESSAGE } };
    }
    if (check === 'text') {
      const budget = checkTextBudget(realm.namespaceId, { now });
      if (budget) {
        return { ok: false, refusal: budget };
      }
    }
  }
  return { ok: true };
};

// HTTP status for a refusal.
export const paidWorkRefusalStatus = (refusal: PaidWorkRefusal): number =>
  refusal.error === 'realm_owner_missing' ? 503 : 429;
