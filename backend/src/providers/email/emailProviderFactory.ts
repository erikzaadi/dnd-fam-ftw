import { getConfig } from '../../config/env.js';
import { CaptureEmailProvider } from './CaptureEmailProvider.js';
import type { EmailProvider } from './EmailProvider.js';
import { SesEmailProvider } from './SesEmailProvider.js';

let provider: EmailProvider | null = null;

// null when email is not configured (EMAIL_PROVIDER=none).
export function getEmailProvider(): EmailProvider | null {
  if (provider) {
    return provider;
  }
  const config = getConfig();
  if (config.EMAIL_PROVIDER === 'capture') {
    provider = new CaptureEmailProvider();
  } else if (config.EMAIL_PROVIDER === 'ses' && config.EMAIL_FROM && config.SES_REGION) {
    provider = new SesEmailProvider(config.SES_REGION, config.EMAIL_FROM);
  }
  return provider;
}

export function setEmailProviderForTests(next: EmailProvider | null): void {
  provider = next;
}
