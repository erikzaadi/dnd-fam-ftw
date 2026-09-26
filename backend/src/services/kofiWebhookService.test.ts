import os from 'os';
import path from 'path';
import fs from 'fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { initializeDatabase } from '../persistence/database.js';
import { kofiPaymentRepository } from '../repositories/kofiPaymentRepository.js';
import { limitRequestRepository } from '../repositories/limitRequestRepository.js';
import { namespaceRepository } from '../repositories/namespaceRepository.js';
import { userRepository } from '../repositories/userRepository.js';
import { handleKofiWebhook, KOFI_SUPPORTER_DAYS } from './kofiWebhookService.js';
import { getEffectiveLimits, getNamespaceTier } from './usageLimitService.js';

const DB_PATH = path.join(os.tmpdir(), `dnd-kofi-test-${Date.now()}.sqlite`);
const TOKEN = 'test-kofi-token';
const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 26, 12);

let txn = 0;
const kofiBody = (overrides: Record<string, unknown> = {}) => ({
  data: JSON.stringify({
    verification_token: TOKEN,
    message_id: `msg-${++txn}`,
    kofi_transaction_id: `txn-${txn}`,
    timestamp: '2026-09-26T12:00:00Z',
    type: 'Donation',
    from_name: 'Jo',
    message: 'Thanks for the adventures',
    amount: '3.00',
    currency: 'EUR',
    email: 'donor@example.com',
    ...overrides,
  }),
});

let freeNs: string;

beforeAll(() => {
  process.env.SQLITE_DB_PATH = DB_PATH;
  process.env.KOFI_VERIFICATION_TOKEN = TOKEN;
  initializeDatabase();
  freeNs = userRepository.createUser('Donor@Example.com', 'Donors', 'member', 'free').namespaceId;
});

afterAll(() => {
  fs.rmSync(DB_PATH, { force: true });
});

describe('handleKofiWebhook', () => {
  it('rejects malformed bodies and wrong tokens', () => {
    expect(handleKofiWebhook({}, NOW).status).toBe(400);
    expect(handleKofiWebhook({ data: 'not json' }, NOW).status).toBe(400);
    expect(handleKofiWebhook(kofiBody({ verification_token: 'wrong' }), NOW).status).toBe(401);
    expect(getNamespaceTier(freeNs, NOW)).toBe('free');
  });

  it('upgrades the donor group for 90 days, matched on the canonical email, and closes its open request', () => {
    const requestId = limitRequestRepository.create(freeNs, null, 'donor@example.com', 'Donated on Ko-fi');
    const result = handleKofiWebhook(kofiBody({ email: '  DONOR@example.com ' }), NOW);
    expect(result).toMatchObject({ status: 200, outcome: 'upgraded', namespaceId: freeNs, supporterUntil: NOW + KOFI_SUPPORTER_DAYS * DAY_MS });
    expect(getNamespaceTier(freeNs, NOW)).toBe('supporter');
    expect(limitRequestRepository.get(requestId!)?.status).toBe('approved');
  });

  it('is idempotent on the Ko-fi transaction id', () => {
    const body = kofiBody();
    const first = handleKofiWebhook(body, NOW);
    const until = namespaceRepository.getNamespaceTier(freeNs)?.expiresAt;
    expect(first).toMatchObject({ status: 200, outcome: 'upgraded' });
    expect(handleKofiWebhook(body, NOW)).toMatchObject({ status: 200, outcome: 'duplicate' });
    expect(namespaceRepository.getNamespaceTier(freeNs)?.expiresAt).toBe(until);
  });

  it('extends from the current expiry and falls back to free once it passes', () => {
    const before = namespaceRepository.getNamespaceTier(freeNs)!.expiresAt!;
    handleKofiWebhook(kofiBody({ type: 'Shop Order' }), NOW);
    const after = namespaceRepository.getNamespaceTier(freeNs)!.expiresAt!;
    expect(after).toBe(before + KOFI_SUPPORTER_DAYS * DAY_MS);
    expect(getNamespaceTier(freeNs, after - 1)).toBe('supporter');
    expect(getNamespaceTier(freeNs, after)).toBe('free');
  });

  it('never touches tiers that do not expire', () => {
    const unlimitedNs = userRepository.createUser('founder@example.com', 'Founders').namespaceId;
    expect(handleKofiWebhook(kofiBody({ email: 'founder@example.com' }), NOW)).toMatchObject({ outcome: 'already_upgraded' });
    expect(getEffectiveLimits(unlimitedNs)).toMatchObject({ tier: 'unlimited', tierExpiresAt: null });

    const patronNs = userRepository.createUser('patron@example.com', 'Patrons', 'member', 'free').namespaceId;
    namespaceRepository.setNamespaceTier(patronNs, 'supporter');
    expect(handleKofiWebhook(kofiBody({ email: 'patron@example.com' }), NOW)).toMatchObject({ outcome: 'already_upgraded' });
    expect(namespaceRepository.getNamespaceTier(patronNs)?.expiresAt).toBeNull();
  });

  it('records payments without a matching account for manual review', () => {
    expect(handleKofiWebhook(kofiBody({ email: 'stranger@example.com' }), NOW)).toMatchObject({ status: 200, outcome: 'no_account', namespaceId: null });
    expect(handleKofiWebhook(kofiBody({ email: null }), NOW)).toMatchObject({ status: 200, outcome: 'no_account' });
    const unmatched = kofiPaymentRepository.list({ outcome: 'no_account' });
    expect(unmatched.map(row => row.email_canonical)).toEqual(expect.arrayContaining(['stranger@example.com', null]));
  });

  it('never upgrades the realm an invited donor plays in, and sends the payment to review', () => {
    const hostNs = userRepository.createUser('host-kofi@example.com', 'Hosts', 'member', 'free').namespaceId;
    // Invite-created shape: the host's realm is the donor's primary, and they own none.
    userRepository.createUserInExistingNamespace('guest-kofi@example.com', hostNs);
    expect(handleKofiWebhook(kofiBody({ email: 'guest-kofi@example.com' }), NOW)).toMatchObject({ status: 200, outcome: 'needs_review', namespaceId: null });
    expect(namespaceRepository.getNamespaceTier(hostNs)).toMatchObject({ tier: 'free' });
    expect(kofiPaymentRepository.list({ outcome: 'needs_review' }).map(row => row.email_canonical)).toContain('guest-kofi@example.com');
  });
});
