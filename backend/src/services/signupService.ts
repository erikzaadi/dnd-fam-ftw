import { getConfig } from '../config/env.js';
import { canonicalEmail } from '../lib/email.js';
import { getDb } from '../persistence/database.js';
import { inviteRequestRepository } from '../repositories/inviteRequestRepository.js';
import { userRepository } from '../repositories/userRepository.js';
import { enqueueSignupNotice } from './emailService.js';
import { isSignupPaused, startOfUtcDay } from './usageLimitService.js';

export type SignInMethod = 'email' | 'google';

export type SignInOutcome =
  | { kind: 'full'; userId: string; email: string; namespaceId: string; created: boolean }
  | { kind: 'pick-namespace'; email: string }
  // No account, and this sign-in may not create one (invite-only, paused, or daily cap).
  // The legacy invite-request flow takes over.
  | { kind: 'invite'; email: string; alreadyRequested: boolean };

const DEFAULT_DAILY_SIGNUP_CAP = 25;

function dailySignupCap(): number {
  const raw = Number(process.env.SIGNUP_DAILY_CAP);
  return Number.isInteger(raw) && raw >= 0 && process.env.SIGNUP_DAILY_CAP?.trim() ? raw : DEFAULT_DAILY_SIGNUP_CAP;
}

function selfServiceSignupsToday(now: Date): number {
  const since = startOfUtcDay(now).toISOString().slice(0, 19).replace('T', ' ');
  const row = getDb().prepare("SELECT COUNT(*) AS count FROM namespaces WHERE tier = 'free' AND created_at >= ?").get(since) as { count: number };
  return row.count;
}

export function canCreateAccounts(now: Date = new Date()): boolean {
  return getConfig().SIGNUP_MODE === 'open' && !isSignupPaused(now) && selfServiceSignupsToday(now) < dailySignupCap();
}

// Resolve a verified email to a sign-in result, creating a private free-tier account
// when signup is open. Must run inside a transaction when paired with consuming a
// sign-in challenge, so a rollback leaves no account, namespace, or notice behind.
// New accounts are always members with their own namespace: public input never picks
// a role, tier, limits, or an existing namespace.
export function resolveVerifiedSignIn(email: string, method: SignInMethod, now: Date = new Date()): SignInOutcome {
  const existing = userRepository.getUserByEmail(email);
  if (existing) {
    const namespaces = userRepository.getUserNamespaces(existing.email);
    if (namespaces.length > 1) {
      return { kind: 'pick-namespace', email: existing.email };
    }
    return { kind: 'full', userId: existing.id, email: existing.email, namespaceId: namespaces[0]?.id ?? existing.namespace_id, created: false };
  }

  const canonical = canonicalEmail(email);
  if (!canCreateAccounts(now)) {
    return { kind: 'invite', email: canonical, alreadyRequested: inviteRequestRepository.hasInviteRequest(canonical) };
  }

  const { userId, namespaceId } = userRepository.createUser(canonical, undefined, 'member', 'free');
  inviteRequestRepository.removeInviteRequest(canonical);
  enqueueSignupNotice({ userId, namespaceId, email: canonical, method, signedUpAt: now });
  console.log(`[Auth] New self-service account userId=${userId} namespaceId=${namespaceId} method=${method}`);
  return { kind: 'full', userId, email: canonical, namespaceId, created: true };
}

// Google is authoritative for its own consumer addresses. Other addresses on a Google
// account must prove the mailbox with an email code before an account is created.
export function isGoogleAuthoritativeEmail(email: string): boolean {
  const domain = canonicalEmail(email).split('@')[1];
  return domain === 'gmail.com' || domain === 'googlemail.com';
}

export function resolveGoogleSignIn(email: string, now: Date = new Date()): SignInOutcome | { kind: 'use-email-code' } {
  const db = getDb();
  return db.transaction(() => {
    if (!userRepository.getUserByEmail(email) && canCreateAccounts(now) && !isGoogleAuthoritativeEmail(email)) {
      return { kind: 'use-email-code' as const };
    }
    return resolveVerifiedSignIn(email, 'google', now);
  })();
}
