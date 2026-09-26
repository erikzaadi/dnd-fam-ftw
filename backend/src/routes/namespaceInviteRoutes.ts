import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import asyncHandler from 'express-async-handler';
import { z } from 'zod';
import { isAuthEnabled } from '../config/env.js';
import { getUsageContext } from '../lib/usageContext.js';
import { peekFullIdentity } from '../middleware/auth.js';
import { authChallengeRepository } from '../repositories/authChallengeRepository.js';
import { dispatchOutbox } from '../services/emailService.js';
import {
  acceptInvitation,
  createInvitation,
  inspectInvitation,
  listInvitations,
  resendInvitation,
  revokeInvitation,
  setMemberInvites,
  type InviteFailure,
} from '../services/namespaceInviteService.js';
import type { AcceptInvitationErrorResponse, InvitationErrorResponse, InvitationSentResponse } from '../types.js';
import { clearPendingAuthCookies, setFullAuthCookie } from './authCookies.js';
import { requireBrowserJsonPost } from './browserPost.js';
import { parseBody } from './routeValidation.js';

const tokenBodySchema = z.object({ token: z.string().max(200) });
const acceptBodySchema = z.object({ token: z.string().max(200), switchAccount: z.boolean().optional() });
const createBodySchema = z.object({ email: z.string().max(320) });
const settingsBodySchema = z.object({ memberInvitesEnabled: z.boolean() });

const VALIDATIONS_PER_IP = 30;
const VALIDATION_WINDOW_MS = 10 * 60 * 1000;

const STATUS_BY_ERROR: Record<InviteFailure['error'], number> = {
  invites_disabled: 404,
  forbidden: 403,
  invalid_email: 400,
  already_member: 409,
  rate_limited: 429,
  cooldown: 429,
  delivery_failed: 502,
  realm_not_ready: 503,
  not_found: 404,
};

const sendFailure = (res: Response, result: InviteFailure) => {
  const body: InvitationErrorResponse = { error: result.error, message: result.message, retryAfterSeconds: result.retryAfterSeconds };
  res.status(STATUS_BY_ERROR[result.error]).json(body);
};

// Invitation tokens are bearer credentials: responses are never cached and never
// leak a referrer.
const noStore = (_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
};

const limitByIp = (req: Request, res: Response, next: NextFunction) => {
  const now = Date.now();
  const windowStart = Math.floor(now / VALIDATION_WINDOW_MS) * VALIDATION_WINDOW_MS;
  if (authChallengeRepository.incrementRateLimit(`invite:ip:${req.ip ?? 'unknown'}`, windowStart) > VALIDATIONS_PER_IP) {
    const body: AcceptInvitationErrorResponse = { error: 'rate_limited' };
    res.status(429).json(body);
    return;
  }
  next();
};

// Public: the invitation token is the proof. Mounted before the cookie auth middleware.
export const createInvitationAuthRouter = ({ isProduction }: { isProduction: boolean }) => {
  const router = Router();
  const guard = [noStore, requireBrowserJsonPost(isProduction), limitByIp];

  router.post('/auth/invitations/inspect', ...guard, (req, res) => {
    if (!isAuthEnabled()) {
      res.status(404).json({ error: 'Auth not configured' });
      return;
    }
    const body = parseBody(req, res, tokenBodySchema);
    if (!body) {
      return;
    }
    res.json(inspectInvitation(body.token, peekFullIdentity(req)?.userId ?? null));
  });

  router.post('/auth/invitations/accept', ...guard, (req, res) => {
    if (!isAuthEnabled()) {
      res.status(404).json({ error: 'Auth not configured' });
      return;
    }
    const body = parseBody(req, res, acceptBodySchema);
    if (!body) {
      return;
    }
    const result = acceptInvitation(body.token, peekFullIdentity(req)?.userId ?? null, body.switchAccount === true);
    if (!result.ok) {
      const error: AcceptInvitationErrorResponse = { error: result.error };
      res.status(result.error === 'signed_in_as_other' ? 409 : result.error === 'signup_closed' ? 503 : 410).json(error);
      return;
    }
    // A fresh session for the recipient in the joined realm. The link itself never
    // becomes a reusable sign-in: it is consumed.
    clearPendingAuthCookies(res);
    setFullAuthCookie(res, { email: result.email, namespaceId: result.namespaceId, type: 'full', userId: result.userId }, { isProduction });
    if (result.created) {
      void dispatchOutbox();
    }
    res.json({ ok: true, namespaceId: result.namespaceId });
  });

  return router;
};

// Realm members managing invitations for their current realm (cookie auth).
export const createNamespaceInviteRouter = () => {
  const router = Router();

  const actor = (res: Response): string | null => {
    const userId = getUsageContext()?.userId ?? null;
    if (!isAuthEnabled() || !userId) {
      res.status(404).json({ error: 'Not found' });
      return null;
    }
    return userId;
  };

  router.get('/namespace/invitations', noStore, (req, res) => {
    const userId = actor(res);
    if (userId) {
      res.json(listInvitations(userId, req.namespaceId));
    }
  });

  router.post('/namespace/invitations', noStore, asyncHandler(async (req, res) => {
    const userId = actor(res);
    const body = userId ? parseBody(req, res, createBodySchema) : null;
    if (!userId || !body) {
      return;
    }
    const result = await createInvitation(userId, req.namespaceId, body.email);
    if (!result.ok) {
      sendFailure(res, result);
      return;
    }
    const sent: InvitationSentResponse = { invitation: result.invitation };
    res.status(201).json(sent);
  }));

  router.post('/namespace/invitations/:id/resend', noStore, asyncHandler(async (req, res) => {
    const userId = actor(res);
    if (!userId) {
      return;
    }
    const result = await resendInvitation(userId, req.namespaceId, String(req.params.id));
    if (!result.ok) {
      sendFailure(res, result);
      return;
    }
    const sent: InvitationSentResponse = { invitation: result.invitation };
    res.json(sent);
  }));

  router.delete('/namespace/invitations/:id', (req, res) => {
    const userId = actor(res);
    if (!userId) {
      return;
    }
    const result = revokeInvitation(userId, req.namespaceId, String(req.params.id));
    if (!result.ok) {
      sendFailure(res, result);
      return;
    }
    res.json({ ok: true });
  });

  router.patch('/namespace/invitation-settings', (req, res) => {
    const userId = actor(res);
    const body = userId ? parseBody(req, res, settingsBodySchema) : null;
    if (!userId || !body) {
      return;
    }
    const result = setMemberInvites(userId, req.namespaceId, body.memberInvitesEnabled);
    if (!result.ok) {
      sendFailure(res, result);
      return;
    }
    res.json({ ok: true });
  });

  return router;
};
