import type { EmailProvider, OutgoingEmail } from './EmailProvider.js';

// Local development and tests: keeps sent mail in memory and prints it, so sign-in
// codes can be read without a mail server. Refused in production at startup.
export class CaptureEmailProvider implements EmailProvider {
  readonly sent: OutgoingEmail[] = [];

  async send(email: OutgoingEmail): Promise<{ messageId: string | null }> {
    this.sent.push(email);
    if (!process.env.VITEST) {
      console.log(`[Email:capture] To: ${email.to}\nSubject: ${email.subject}\n\n${email.text}\n`);
    }
    return { messageId: `capture-${this.sent.length}` };
  }
}
