import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { isDeviceSignInEnabled } from '../config/env.js';
import { denyDeviceSessions, requireFullIdentity } from '../middleware/auth.js';
import { dispatchOutbox } from '../services/emailService.js';
import {
  approvePairing,
  denyPairing,
  listDeviceGrants,
  lookupPairing,
  pollPairing,
  revokeDeviceGrant,
  startPairing,
  type CodeCheckFailure,
} from '../services/devicePairingService.js';
import type {
  DeviceGrantSummary,
  DevicePairingApproveResponse,
  DevicePairingErrorResponse,
  DevicePairingLookupResponse,
  DevicePairingPollResponse,
  DevicePairingStartResponse,
} from '../types.js';
import { DEVICE_PAIRING_COOKIE, setDevicePairingCookie, setFullAuthCookie } from './authCookies.js';
import { requireBrowserJsonPost } from './browserPost.js';
import { parseBody } from './routeValidation.js';

interface DeviceAuthRoutesOptions {
  isProduction: boolean;
}

const codeBodySchema = z.object({
  code: z.string().max(32),
});

const approveBodySchema = codeBodySchema.extend({
  namespaceId: z.string().min(1).max(64),
  label: z.string().max(200).optional(),
});

const readDeviceToken = (req: Request): string | undefined =>
  (req.cookies as Record<string, string> | undefined)?.[DEVICE_PAIRING_COOKIE];

// TV sign-in (device pairing): the TV starts and polls; a signed-in phone or laptop
// looks up, approves or denies the code, and manages its signed-in TVs.
export const createDeviceAuthRouter = ({ isProduction }: DeviceAuthRoutesOptions) => {
  const router = Router();

  // Codes, poll results and Set-Cookie must never sit in a browser, TV or proxy cache.
  const deviceRoutes = (_req: Request, res: Response, next: NextFunction) => {
    res.set('Cache-Control', 'no-store');
    if (!isDeviceSignInEnabled()) {
      res.status(404).json({ error: 'TV sign-in not available' });
      return;
    }
    next();
  };
  router.use(['/auth/device', '/auth/devices'], deviceRoutes);

  const approver = [requireBrowserJsonPost(isProduction), requireFullIdentity, denyDeviceSessions];

  const codeError = (res: Response, result: CodeCheckFailure | { status: 'not_member' }) => {
    const body: DevicePairingErrorResponse = result.status === 'rate_limited'
      ? { error: 'rate_limited', retryAfterSeconds: result.retryAfterSeconds }
      : { error: result.status };
    res.status(result.status === 'rate_limited' ? 429 : result.status === 'not_member' ? 403 : 400).json(body);
  };

  router.post('/auth/device/start', (req, res) => {
    const result = startPairing(readDeviceToken(req), req.get('user-agent'), req.ip ?? 'unknown');
    if (result.status === 'rate_limited') {
      res.status(429).json({ error: 'rate_limited', retryAfterSeconds: result.retryAfterSeconds });
      return;
    }
    setDevicePairingCookie(res, result.deviceToken, { isProduction });
    const body: DevicePairingStartResponse = {
      userCode: result.userCode,
      expiresInSeconds: result.expiresInSeconds,
      intervalSeconds: result.intervalSeconds,
    };
    res.status(202).json(body);
  });

  router.get('/auth/device/poll', (req, res) => {
    const result = pollPairing(readDeviceToken(req));
    if (result.status === 'approved') {
      const { identity } = result;
      setFullAuthCookie(res, {
        email: identity.email,
        namespaceId: identity.namespaceId,
        type: 'full',
        userId: identity.userId,
        deviceGrantId: identity.grantId,
      }, { isProduction, maxExpiresAt: identity.maxExpiresAt });
      // If this response is lost, the TV keeps its device cookie and the next poll recovers.
      res.clearCookie(DEVICE_PAIRING_COOKIE, { path: '/' });
    }
    const body: DevicePairingPollResponse = { status: result.status };
    res.json(body);
  });

  router.post('/auth/device/lookup', ...approver, (req, res) => {
    const body = parseBody(req, res, codeBodySchema);
    if (!body) {
      return;
    }
    const result = lookupPairing(body.code, req.fullIdentity!.userId, req.ip ?? 'unknown');
    if (result.status !== 'found') {
      codeError(res, result);
      return;
    }
    const response: DevicePairingLookupResponse = { deviceLabel: result.deviceLabel, createdAt: result.createdAt, expiresAt: result.expiresAt };
    res.json(response);
  });

  router.post('/auth/device/approve', ...approver, (req, res) => {
    const body = parseBody(req, res, approveBodySchema);
    if (!body) {
      return;
    }
    const result = approvePairing({ code: body.code, userId: req.fullIdentity!.userId, namespaceId: body.namespaceId, label: body.label }, req.ip ?? 'unknown');
    if (result.status !== 'approved') {
      codeError(res, result);
      return;
    }
    void dispatchOutbox();
    const response: DevicePairingApproveResponse = { deviceLabel: result.deviceLabel, signedOutLabel: result.signedOutLabel };
    res.json(response);
  });

  router.post('/auth/device/deny', ...approver, (req, res) => {
    const body = parseBody(req, res, codeBodySchema);
    if (!body) {
      return;
    }
    const result = denyPairing(body.code, req.fullIdentity!.userId, req.ip ?? 'unknown');
    if (result.status !== 'denied') {
      codeError(res, result);
      return;
    }
    res.json({ ok: true });
  });

  router.get('/auth/devices', requireFullIdentity, denyDeviceSessions, (req, res) => {
    const body: DeviceGrantSummary[] = listDeviceGrants(req.fullIdentity!.userId);
    res.json(body);
  });

  router.post('/auth/devices/:id/revoke', ...approver, (req, res) => {
    if (!revokeDeviceGrant(String(req.params.id), req.fullIdentity!.userId, 'user')) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.json({ ok: true });
  });

  return router;
};
