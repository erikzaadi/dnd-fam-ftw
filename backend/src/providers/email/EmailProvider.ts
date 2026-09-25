export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface EmailProvider {
  // Resolves with the provider's message id once the provider accepted the message.
  // Acceptance is not proof of inbox delivery.
  send(email: OutgoingEmail): Promise<{ messageId: string | null }>;
}
