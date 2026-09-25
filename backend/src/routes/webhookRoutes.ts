import express, { Router } from 'express';
import { dispatchOutbox } from '../services/emailService.js';
import { handleKofiWebhook } from '../services/kofiWebhookService.js';

// Public, unauthenticated endpoints called by third parties. Each one verifies its
// own shared secret.
export const createWebhookRouter = () => {
  const router = Router();

  // Ko-fi retries until it gets a 200, so every verified payment (even ignored or
  // repeated ones) answers 200.
  router.post('/webhooks/kofi', express.urlencoded({ extended: false, limit: '32kb' }), (req, res) => {
    const result = handleKofiWebhook(req.body);
    if (result.status !== 200) {
      if (result.status === 401) {
        console.warn('[Ko-fi] Rejected webhook with a wrong verification token');
      }
      res.sendStatus(result.status);
      return;
    }
    if (result.outcome !== 'duplicate') {
      console.log(`[Ko-fi] Payment ${result.transactionId}: ${result.outcome}${result.namespaceId ? ` (namespace ${result.namespaceId})` : ''}`);
      void dispatchOutbox();
    }
    res.sendStatus(200);
  });

  return router;
};
