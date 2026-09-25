// The in-progress email sign-in, kept in sessionStorage so a reload of the code screen
// (or switching to the mail app on mobile) does not lose it. The code itself is never stored.
export interface PendingEmailSignIn {
  challengeId: string;
  email: string;
  maskedEmail: string;
  resendAt: number;
  expiresAt: number;
}

const KEY = 'emailSignIn';

export function savePendingEmailSignIn(pending: PendingEmailSignIn): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(pending));
  } catch {
    // Storage unavailable (private mode): the in-memory navigation state still works.
  }
}

export function loadPendingEmailSignIn(): PendingEmailSignIn | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<PendingEmailSignIn>;
    if (typeof parsed.challengeId !== 'string' || typeof parsed.maskedEmail !== 'string') {
      return null;
    }
    return {
      challengeId: parsed.challengeId,
      email: typeof parsed.email === 'string' ? parsed.email : '',
      maskedEmail: parsed.maskedEmail,
      resendAt: typeof parsed.resendAt === 'number' ? parsed.resendAt : 0,
      expiresAt: typeof parsed.expiresAt === 'number' ? parsed.expiresAt : 0,
    };
  } catch {
    return null;
  }
}

export function clearPendingEmailSignIn(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

export function formatWait(seconds: number): string {
  if (seconds < 60) {
    return `${seconds} second${seconds === 1 ? '' : 's'}`;
  }
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}
