import os from 'os';
import path from 'path';
import fs from 'fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb, initializeDatabase } from '../persistence/database.js';
import { setEmailProviderForTests } from '../providers/email/emailProviderFactory.js';
import { emailOutboxRepository } from '../repositories/emailOutboxRepository.js';
import { dispatchOutbox, OUTBOX_MAX_ATTEMPTS } from './emailService.js';

const DB_PATH = path.join(os.tmpdir(), `dnd-email-outbox-test-${Date.now()}.sqlite`);
let failing = true;
let sent = 0;

const row = (eventKey: string) => getDb().prepare('SELECT * FROM email_outbox WHERE event_key = ?').get(eventKey) as { status: string; attempts: number; next_attempt_at: number; last_error: string | null };
const makeDue = () => getDb().prepare("UPDATE email_outbox SET next_attempt_at = 0 WHERE status = 'pending'").run();

beforeAll(() => {
  process.env.SQLITE_DB_PATH = DB_PATH;
  initializeDatabase();
  setEmailProviderForTests({
    send: async () => {
      if (failing) {
        throw new Error('provider down');
      }
      sent++;
      return { messageId: 'msg-1' };
    },
  });
});

afterAll(() => {
  setEmailProviderForTests(null);
  fs.rmSync(DB_PATH, { force: true });
});

describe('email outbox', () => {
  it('backs off after a failed send, then sends once the provider recovers', async () => {
    emailOutboxRepository.enqueue({ eventKey: 'retry', recipient: 'ops@example.com', subject: 's', textBody: 't', htmlBody: 'h' }, 0);
    const before = Date.now();
    await dispatchOutbox();
    expect(row('retry')).toMatchObject({ status: 'pending', attempts: 1, last_error: 'provider down' });
    expect(row('retry').next_attempt_at).toBeGreaterThanOrEqual(before + 60_000);

    // Not due yet: another run leaves it alone.
    await dispatchOutbox();
    expect(row('retry').attempts).toBe(1);

    failing = false;
    makeDue();
    await dispatchOutbox();
    expect(row('retry')).toMatchObject({ status: 'sent', attempts: 2 });
    expect(sent).toBe(1);
    failing = true;
  });

  it('gives up after the last attempt', async () => {
    emailOutboxRepository.enqueue({ eventKey: 'give-up', recipient: 'ops@example.com', subject: 's', textBody: 't', htmlBody: 'h' }, 0);
    for (let attempt = 1; attempt <= OUTBOX_MAX_ATTEMPTS; attempt++) {
      makeDue();
      await dispatchOutbox();
      expect(row('give-up')).toMatchObject({ attempts: attempt, status: attempt < OUTBOX_MAX_ATTEMPTS ? 'pending' : 'failed' });
    }
    makeDue();
    await dispatchOutbox();
    expect(row('give-up').attempts).toBe(OUTBOX_MAX_ATTEMPTS);
  });
});
