import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import type { EmailProvider, OutgoingEmail } from './EmailProvider.js';

// Amazon SES v2. Credentials come from the default AWS credential chain (the app IAM
// user's keys on Lightsail). SES account-level suppression handles bounces/complaints.
export class SesEmailProvider implements EmailProvider {
  private readonly client: SESv2Client;

  constructor(region: string, private readonly from: string) {
    this.client = new SESv2Client({ region });
  }

  async send(email: OutgoingEmail): Promise<{ messageId: string | null }> {
    const result = await this.client.send(new SendEmailCommand({
      FromEmailAddress: this.from,
      Destination: { ToAddresses: [email.to] },
      Content: {
        Simple: {
          Subject: { Data: email.subject, Charset: 'UTF-8' },
          Body: {
            Text: { Data: email.text, Charset: 'UTF-8' },
            Html: { Data: email.html, Charset: 'UTF-8' },
          },
        },
      },
    }));
    return { messageId: result.MessageId ?? null };
  }
}
