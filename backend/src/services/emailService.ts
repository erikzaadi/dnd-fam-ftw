import { getConfig } from '../config/env.js';
import { emailOutboxRepository } from '../repositories/emailOutboxRepository.js';
import type { KofiPaymentOutcome } from '../repositories/kofiPaymentRepository.js';
import { getEmailProvider } from '../providers/email/emailProviderFactory.js';
import type { OutgoingEmail } from '../providers/email/EmailProvider.js';

const OUTBOX_SWEEP_INTERVAL_MS = 3 * 60 * 1000;
const OUTBOX_BATCH_SIZE = 10;
export const OUTBOX_MAX_ATTEMPTS = 10;

const escapeHtml = (value: string): string => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

export function getAppUrl(): string {
  const config = getConfig();
  return `${config.FRONTEND_URL ?? ''}${config.APP_BASE_PATH}`;
}

export function buildSignInCodeEmail(to: string, code: string, expiresInMinutes: number): OutgoingEmail {
  const appUrl = getAppUrl();
  const text = [
    `Your sign-in code is: ${code}`,
    '',
    `It expires in ${expiresInMinutes} minutes. Enter it in the browser where you asked for it.`,
    '',
    "If you didn't request this, you can ignore this email.",
    '',
    appUrl,
  ].join('\n');
  const html = `<!doctype html><html><body style="font-family:sans-serif;color:#0f172a">
<p>Your sign-in code is:</p>
<p style="font-size:28px;font-weight:bold;letter-spacing:4px">${escapeHtml(code)}</p>
<p>It expires in ${expiresInMinutes} minutes. Enter it in the browser where you asked for it.</p>
<p style="color:#64748b">If you didn't request this, you can ignore this email.</p>
${appUrl.startsWith('http') ? `<p><a href="${escapeHtml(appUrl)}">${escapeHtml(appUrl)}</a></p>` : ''}
</body></html>`;
  return { to, subject: 'Your sign-in code', text, html };
}

// Realm names are player-chosen and end up in mail: one line, no control characters,
// bounded length. HTML escaping happens where they are rendered.
export function safeRealmName(name: string): string {
  // eslint-disable-next-line no-control-regex
  const clean = name.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim();
  return clean.length > 60 ? `${clean.slice(0, 59)}…` : clean || 'a realm';
}

export interface InvitationEmail {
  to: string;
  inviterEmail: string;
  realmName: string;
  link: string;
  expiresAt: Date;
}

// Sent directly (never through the plaintext outbox): the link is a bearer credential.
export function buildInvitationEmail(invite: InvitationEmail): OutgoingEmail {
  const realm = safeRealmName(invite.realmName);
  const expires = invite.expiresAt.toUTCString().replace(/ \d\d:\d\d:\d\d GMT$/, '');
  const text = [
    `${invite.inviterEmail} invited you to join the realm "${realm}" on AI DM, a family storytelling adventure game.`,
    '',
    `Join realm: ${invite.link}`,
    '',
    `The link works once and expires on ${expires}.`,
    'Please do not forward this email: anyone with the link can join as you.',
    "If you weren't expecting this, you can ignore it.",
  ].join('\n');
  const html = `<!doctype html><html><body style="font-family:sans-serif;color:#0f172a">
<p><strong>${escapeHtml(invite.inviterEmail)}</strong> invited you to join the realm <strong>${escapeHtml(realm)}</strong> on AI DM, a family storytelling adventure game.</p>
<p><a href="${escapeHtml(invite.link)}" style="display:inline-block;padding:12px 20px;background:#f59e0b;color:#0f172a;border-radius:12px;font-weight:bold;text-decoration:none">Join realm</a></p>
<p>The link works once and expires on ${escapeHtml(expires)}.</p>
<p style="color:#64748b">Please do not forward this email: anyone with the link can join as you. If you weren't expecting this, you can ignore it.</p>
</body></html>`;
  return { to: invite.to, subject: `You're invited to join ${realm}`, text, html };
}

export interface SignupNotice {
  userId: string;
  namespaceId: string;
  email: string;
  method: 'email' | 'google' | 'invite';
  signedUpAt: Date;
}

// Owner notices need a mailbox and a working email provider; otherwise they are only
// logged, so the outbox does not fill with mail that can never be sent.
function ownerNoticeRecipient(): string | null {
  const recipient = getConfig().SIGNUP_NOTIFY_EMAIL;
  return recipient && getEmailProvider() ? recipient : null;
}

// Enqueue inside the activation transaction; delivery happens after commit.
export function enqueueSignupNotice(notice: SignupNotice): void {
  const recipient = ownerNoticeRecipient();
  if (!recipient) {
    return;
  }
  const lines = [
    `Email: ${notice.email}`,
    `Signed up: ${notice.signedUpAt.toISOString()}`,
    `Method: ${notice.method}`,
    `User ID: ${notice.userId}`,
    `Namespace ID: ${notice.namespaceId}`,
  ];
  emailOutboxRepository.enqueue({
    eventKey: `signup:${notice.userId}`,
    recipient,
    subject: 'New adventurer signed up',
    textBody: `A new adventurer signed up.\n\n${lines.join('\n')}\n`,
    htmlBody: `<!doctype html><html><body style="font-family:sans-serif"><p>A new adventurer signed up.</p><ul>${lines.map(line => `<li>${escapeHtml(line)}</li>`).join('')}</ul></body></html>`,
  }, notice.signedUpAt.getTime());
}

export interface LimitRequestNotice {
  requestId: number;
  namespaceId: string;
  namespaceName: string | null;
  tier: string;
  email: string | null;
  note: string | null;
  requestedAt: Date;
}

export function enqueueLimitRequestNotice(notice: LimitRequestNotice): void {
  const recipient = ownerNoticeRecipient();
  if (!recipient) {
    return;
  }
  const lines = [
    `Group: ${notice.namespaceName ?? notice.namespaceId} (${notice.namespaceId})`,
    `Current tier: ${notice.tier}`,
    `Requested by: ${notice.email ?? 'unknown'}`,
    `Requested: ${notice.requestedAt.toISOString()}`,
    `Note: ${notice.note ?? '(none)'}`,
  ];
  const approve = `cli limit-requests approve ${notice.requestId}`;
  emailOutboxRepository.enqueue({
    eventKey: `limit-request:${notice.requestId}`,
    recipient,
    subject: 'A realm asked for more adventures',
    textBody: `A group asked for higher limits.\n\n${lines.join('\n')}\n\nApprove with: ${approve}\n`,
    htmlBody: `<!doctype html><html><body style="font-family:sans-serif"><p>A group asked for higher limits.</p><ul>${lines.map(line => `<li>${escapeHtml(line)}</li>`).join('')}</ul><p>Approve with: <code>${escapeHtml(approve)}</code></p></body></html>`,
  }, notice.requestedAt.getTime());
}

export interface KofiPaymentNotice {
  transactionId: string;
  type: string;
  fromName: string | null;
  email: string | null;
  amount: string | null;
  message: string | null;
  outcome: KofiPaymentOutcome;
  namespaceId: string | null;
  namespaceName: string | null;
  supporterUntil: number | null;
  receivedAt: Date;
}

const KOFI_OUTCOME_TEXT: Record<KofiPaymentOutcome, string> = {
  upgraded: 'The group is now a supporter.',
  already_upgraded: 'The group already has a tier that does not expire; nothing changed.',
  no_account: 'No account uses this email. Find the group by hand and use cli namespaces tier <id> supporter.',
  needs_review: 'The donor has an account but does not own exactly one realm (for example they only play in a realm they were invited to). Pick the group by hand and use cli namespaces tier <id> supporter.',
};

export function enqueueKofiPaymentNotice(notice: KofiPaymentNotice): void {
  const recipient = ownerNoticeRecipient();
  if (!recipient) {
    return;
  }
  const lines = [
    `Type: ${notice.type}`,
    `Amount: ${notice.amount ?? 'unknown'}`,
    `From: ${notice.fromName ?? 'unknown'} <${notice.email ?? 'no email'}>`,
    `Message: ${notice.message ?? '(none)'}`,
    `Group: ${notice.namespaceId ? `${notice.namespaceName ?? notice.namespaceId} (${notice.namespaceId})` : '(no matching account)'}`,
    ...(notice.supporterUntil ? [`Supporter until: ${new Date(notice.supporterUntil).toISOString()}`] : []),
    `Ko-fi transaction: ${notice.transactionId}`,
    `Received: ${notice.receivedAt.toISOString()}`,
  ];
  const outcome = KOFI_OUTCOME_TEXT[notice.outcome];
  emailOutboxRepository.enqueue({
    eventKey: `kofi:${notice.transactionId}`,
    recipient,
    subject: 'A Ko-fi supporter helped the realm',
    textBody: `A Ko-fi payment arrived. ${outcome}\n\n${lines.join('\n')}\n`,
    htmlBody: `<!doctype html><html><body style="font-family:sans-serif"><p>A Ko-fi payment arrived. ${escapeHtml(outcome)}</p><ul>${lines.map(line => `<li>${escapeHtml(line)}</li>`).join('')}</ul></body></html>`,
  }, notice.receivedAt.getTime());
}

export interface InviteRequestNotice {
  email: string;
  message: string | null;
  requestedAt: Date;
}

export function enqueueInviteRequestNotice(notice: InviteRequestNotice): void {
  const recipient = ownerNoticeRecipient();
  if (!recipient) {
    return;
  }
  const lines = [
    `Email: ${notice.email}`,
    `Requested: ${notice.requestedAt.toISOString()}`,
    `Message: ${notice.message ?? '(none)'}`,
  ];
  const approve = `cli invite-requests approve ${notice.email}`;
  emailOutboxRepository.enqueue({
    eventKey: `invite-request:${notice.email}:${notice.requestedAt.getTime()}`,
    recipient,
    subject: 'Someone asked to join the realm',
    textBody: `Someone asked for an invite.\n\n${lines.join('\n')}\n\nApprove with: ${approve}\n`,
    htmlBody: `<!doctype html><html><body style="font-family:sans-serif"><p>Someone asked for an invite.</p><ul>${lines.map(line => `<li>${escapeHtml(line)}</li>`).join('')}</ul><p>Approve with: <code>${escapeHtml(approve)}</code></p></body></html>`,
  }, notice.requestedAt.getTime());
}

export interface McpAccessRequestNotice {
  requestId: number;
  email: string;
  namespaceId: string;
  namespaceName: string | null;
  tier: string;
  note: string | null;
  requestedAt: Date;
}

export function enqueueMcpAccessRequestNotice(notice: McpAccessRequestNotice): void {
  const recipient = ownerNoticeRecipient();
  if (!recipient) {
    return;
  }
  const lines = [
    `Player: ${notice.email}`,
    `Realm: ${notice.namespaceName ?? notice.namespaceId} (${notice.namespaceId}), tier ${notice.tier}`,
    `Requested: ${notice.requestedAt.toISOString()}`,
    `Note: ${notice.note ?? '(none)'}`,
  ];
  const approve = `cli mcp-requests approve ${notice.requestId}`;
  emailOutboxRepository.enqueue({
    eventKey: `mcp-access-request:${notice.requestId}`,
    recipient,
    subject: 'A player asked for AI assistant access',
    textBody: `A player asked to play through an AI assistant (MCP).\n\n${lines.join('\n')}\n\nApprove with: ${approve}\n`,
    htmlBody: `<!doctype html><html><body style="font-family:sans-serif"><p>A player asked to play through an AI assistant (MCP).</p><ul>${lines.map(line => `<li>${escapeHtml(line)}</li>`).join('')}</ul><p>Approve with: <code>${escapeHtml(approve)}</code></p></body></html>`,
  }, notice.requestedAt.getTime());
}

// Tells the player their request was approved. Needs a working email provider.
export function enqueueMcpAccessGrantedNotice(notice: { requestId: number; email: string; grantedAt: Date }): void {
  if (!getEmailProvider()) {
    return;
  }
  const pageUrl = `${getAppUrl()}access-tokens`;
  const link = pageUrl.startsWith('http') ? pageUrl : null;
  const text = [
    'Good news: you can now play your adventures from an AI assistant such as Claude Code, Codex, or Cursor.',
    '',
    `Create a token under Settings > AI assistants${link ? `: ${link}` : '.'}`,
  ].join('\n');
  emailOutboxRepository.enqueue({
    eventKey: `mcp-access-granted:${notice.requestId}`,
    recipient: notice.email,
    subject: 'Your AI assistant access is ready',
    textBody: `${text}\n`,
    htmlBody: `<!doctype html><html><body style="font-family:sans-serif;color:#0f172a"><p>Good news: you can now play your adventures from an AI assistant such as Claude Code, Codex, or Cursor.</p><p>Create a token under Settings &gt; AI assistants${link ? `: <a href="${escapeHtml(link)}">${escapeHtml(link)}</a>` : '.'}</p></body></html>`,
  }, notice.grantedAt.getTime());
}

// One dispatcher per backend process; runs never overlap. With more than one backend
// replica this needs a lease before it can run safely in each.
let dispatching: Promise<void> | null = null;
let sweepTimer: ReturnType<typeof setInterval> | null = null;

export function dispatchOutbox(): Promise<void> {
  if (!dispatching) {
    dispatching = runOutboxBatch().finally(() => {
      dispatching = null;
    });
  }
  return dispatching;
}

async function runOutboxBatch(): Promise<void> {
  const provider = getEmailProvider();
  if (!provider) {
    return;
  }
  const now = Date.now();
  for (const row of emailOutboxRepository.listDue(now, OUTBOX_BATCH_SIZE)) {
    emailOutboxRepository.markAttempt(row.id);
    try {
      const { messageId } = await provider.send({ to: row.recipient, subject: row.subject, text: row.text_body, html: row.html_body });
      emailOutboxRepository.markSent(row.id, messageId);
      console.log(`[Email] Sent ${row.event_key}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Exponential backoff: 1, 2, 4 ... minutes, capped at an hour.
      const backoffMs = Math.min(60 * 60 * 1000, 60 * 1000 * 2 ** row.attempts);
      emailOutboxRepository.markRetry(row.id, message, Date.now() + backoffMs, OUTBOX_MAX_ATTEMPTS);
      console.warn(`[Email] Sending ${row.event_key} failed (attempt ${row.attempts + 1}): ${message}`);
    }
  }
}

export function startOutboxDispatcher(): void {
  if (sweepTimer || !getEmailProvider()) {
    return;
  }
  void dispatchOutbox();
  sweepTimer = setInterval(() => {
    void dispatchOutbox();
  }, OUTBOX_SWEEP_INTERVAL_MS);
  sweepTimer.unref();
}
