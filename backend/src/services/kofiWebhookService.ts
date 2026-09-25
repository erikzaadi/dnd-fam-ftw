import { z } from 'zod';
import { getConfig } from '../config/env.js';
import { canonicalEmail } from '../lib/email.js';
import { withTransaction } from '../persistence/transaction.js';
import { kofiPaymentRepository, type KofiPaymentOutcome } from '../repositories/kofiPaymentRepository.js';
import { limitRequestRepository } from '../repositories/limitRequestRepository.js';
import { namespaceRepository } from '../repositories/namespaceRepository.js';
import { userRepository } from '../repositories/userRepository.js';
import { safeEqual } from './authService.js';
import { enqueueKofiPaymentNotice } from './emailService.js';
import { getNamespaceTier } from './usageLimitService.js';

// Each payment makes the donor's group a supporter for this long, counted from the
// current expiry when the group is still a supporter.
export const KOFI_SUPPORTER_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

// Ko-fi posts application/x-www-form-urlencoded with one field, `data`, holding JSON.
// Only the fields used here are checked; Ko-fi may add more.
const kofiPayloadSchema = z.object({
  verification_token: z.string(),
  message_id: z.string().optional(),
  kofi_transaction_id: z.string().nullish(),
  timestamp: z.string().nullish(),
  type: z.string(),
  from_name: z.string().nullish(),
  message: z.string().nullish(),
  amount: z.union([z.string(), z.number()]).nullish(),
  currency: z.string().nullish(),
  email: z.string().nullish(),
});

export type KofiPayload = z.infer<typeof kofiPayloadSchema>;

export type KofiWebhookResult =
  | { status: 404 | 400 | 401 }
  | { status: 200; transactionId: string; outcome: KofiPaymentOutcome | 'duplicate'; namespaceId: string | null; supporterUntil: number | null };

export function parseKofiBody(body: unknown): KofiPayload | null {
  const data = (body as { data?: unknown } | null | undefined)?.data;
  if (typeof data !== 'string' || data.length > 16_000) {
    return null;
  }
  try {
    const parsed = kofiPayloadSchema.safeParse(JSON.parse(data));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

const clip = (value: string | null | undefined, max: number): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, max) : null;
};

export function handleKofiWebhook(body: unknown, now: number = Date.now()): KofiWebhookResult {
  const token = getConfig().KOFI_VERIFICATION_TOKEN;
  if (!token) {
    return { status: 404 };
  }
  const payload = parseKofiBody(body);
  if (!payload) {
    return { status: 400 };
  }
  if (!safeEqual(payload.verification_token, token)) {
    return { status: 401 };
  }
  const transactionId = clip(payload.kofi_transaction_id, 200) ?? clip(payload.message_id, 200);
  if (!transactionId) {
    return { status: 400 };
  }

  return withTransaction(() => {
    if (kofiPaymentRepository.exists(transactionId)) {
      return { status: 200, transactionId, outcome: 'duplicate', namespaceId: null, supporterUntil: null } as const;
    }
    const email = clip(payload.email, 320);
    const user = email ? userRepository.getUserByEmail(email) : null;
    let outcome: KofiPaymentOutcome = 'no_account';
    let supporterUntil: number | null = null;
    const namespaceId = user?.namespace_id ?? null;

    if (namespaceId) {
      const stored = namespaceRepository.getNamespaceTier(namespaceId);
      const effective = getNamespaceTier(namespaceId, now);
      const neverExpires = effective === 'unlimited' || (effective === 'supporter' && stored?.expiresAt == null);
      if (neverExpires) {
        outcome = 'already_upgraded';
      } else {
        const base = effective === 'supporter' ? Math.max(now, stored?.expiresAt ?? now) : now;
        supporterUntil = base + KOFI_SUPPORTER_DAYS * DAY_MS;
        namespaceRepository.setNamespaceTier(namespaceId, 'supporter', supporterUntil);
        const open = limitRequestRepository.getOpen(namespaceId);
        if (open) {
          limitRequestRepository.resolve(open.id, 'approved');
        }
        outcome = 'upgraded';
      }
    }

    const amount = payload.amount == null ? null : clip(String(payload.amount), 32);
    kofiPaymentRepository.insert({
      transaction_id: transactionId,
      type: clip(payload.type, 40) ?? 'unknown',
      email_canonical: email ? canonicalEmail(email) : null,
      from_name: clip(payload.from_name, 200),
      amount,
      currency: clip(payload.currency, 10),
      message: clip(payload.message, 1000),
      outcome,
      namespace_id: namespaceId,
      supporter_until: supporterUntil,
      kofi_timestamp: clip(payload.timestamp, 64),
    });
    enqueueKofiPaymentNotice({
      transactionId,
      type: payload.type,
      fromName: clip(payload.from_name, 200),
      email,
      amount: amount ? `${amount} ${clip(payload.currency, 10) ?? ''}`.trim() : null,
      message: clip(payload.message, 1000),
      outcome,
      namespaceId,
      namespaceName: namespaceId ? namespaceRepository.getNamespaceById(namespaceId)?.name ?? null : null,
      supporterUntil,
      receivedAt: new Date(now),
    });
    return { status: 200, transactionId, outcome, namespaceId, supporterUntil } as const;
  });
}
