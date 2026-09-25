import { domainToASCII } from 'url';

// One canonical form for every email lookup (login, signup, CLI, admin bootstrap,
// invites): trimmed and lowercased. Plus tags and Gmail dots are kept, since they
// can be different mailboxes elsewhere.
export function canonicalEmail(email: string): string {
  return email.trim().toLowerCase();
}

const LOCAL_PART = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
const DOMAIN_LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

// Validates user-entered addresses for email sign-in and returns the canonical form,
// or null. ASCII local parts only; internationalized domains are converted to their
// ASCII (punycode) form.
export function parseEmailAddress(input: unknown): string | null {
  if (typeof input !== 'string' || input.length > 320) {
    return null;
  }
  const trimmed = input.trim();
  // eslint-disable-next-line no-control-regex
  if (/[\s\u0000-\u001f\u007f]/.test(trimmed)) {
    return null;
  }
  const at = trimmed.lastIndexOf('@');
  if (at <= 0 || at === trimmed.length - 1) {
    return null;
  }
  const local = trimmed.slice(0, at).toLowerCase();
  const domain = domainToASCII(trimmed.slice(at + 1).toLowerCase());
  if (!domain || local.length > 64 || !LOCAL_PART.test(local)) {
    return null;
  }
  const labels = domain.split('.');
  if (labels.length < 2 || !labels.every(label => DOMAIN_LABEL.test(label)) || /^\d+$/.test(labels[labels.length - 1])) {
    return null;
  }
  const email = `${local}@${domain}`;
  return email.length <= 254 ? email : null;
}

// "hero@example.com" -> "h***@example.com"
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) {
    return '***';
  }
  return `${email[0]}***${email.slice(at)}`;
}
