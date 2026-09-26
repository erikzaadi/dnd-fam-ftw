import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { isAuthEnabled, isMcpOAuthEnabled } from '../config/env.js';
import { getUsageContext } from '../lib/usageContext.js';
import { oauthAuthorizationService } from '../oauth/authorizationService.js';
import { ACCESS_TOKEN_SCOPE_VALUES, type OAuthConsentDecisionResponse } from '../types.js';
import { requireBrowserJsonPost } from './browserPost.js';
import { parseBody } from './routeValidation.js';

const decisionBodySchema = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('deny') }).strict(),
  z.object({
    decision: z.literal('approve'),
    namespaceId: z.string().min(1).max(100),
    scopes: z.array(z.enum(ACCESS_TOKEN_SCOPE_VALUES)).max(ACCESS_TOKEN_SCOPE_VALUES.length),
  }).strict(),
]);

const DECISION_ERRORS = {
  not_found: 'This sign-in request has expired or was already answered. Start connecting again from your assistant.',
  not_eligible: 'Assistant access is not on for you in that realm.',
};

// Website side of MCP OAuth consent. Mounted behind the cookie authMiddleware: only a
// signed-in player can see or answer a pending request, and the answer is bound to
// that player at this moment.
export const createOAuthConsentRouter = ({ isProduction }: { isProduction: boolean }) => {
  const router = Router();

  const requireOAuthUser = (req: Request, res: Response, next: NextFunction) => {
    if (!isAuthEnabled() || !isMcpOAuthEnabled() || !getUsageContext()?.userId || !req.userEmail) {
      res.status(404).json({ error: 'not_found', message: DECISION_ERRORS.not_found });
      return;
    }
    next();
  };

  router.get('/oauth-consent/:requestId', requireOAuthUser, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const details = oauthAuthorizationService.getConsentDetails(req.params.requestId as string, {
      userId: getUsageContext()!.userId!,
      email: req.userEmail!,
      currentNamespaceId: req.namespaceId,
    });
    if (!details) {
      res.status(404).json({ error: 'not_found', message: DECISION_ERRORS.not_found });
      return;
    }
    res.json(details);
  });

  router.post('/oauth-consent/:requestId', requireBrowserJsonPost(isProduction), requireOAuthUser, (req, res) => {
    const body = parseBody(req, res, decisionBodySchema);
    if (!body) {
      return;
    }
    res.setHeader('Cache-Control', 'no-store');
    const userId = getUsageContext()!.userId!;
    const result = oauthAuthorizationService.decide(
      req.params.requestId as string,
      { userId },
      body.decision === 'approve' ? { approve: true, namespaceId: body.namespaceId, scopes: body.scopes } : { approve: false },
    );
    if (!result.ok) {
      res.status(result.status).json({ error: result.error, message: DECISION_ERRORS[result.error] });
      return;
    }
    console.log(`[OAuth] Consent ${body.decision} by user ${userId}${body.decision === 'approve' ? ` for namespace ${body.namespaceId}` : ''}`);
    const response: OAuthConsentDecisionResponse = { redirectUrl: result.redirectUrl };
    res.json(response);
  });

  return router;
};
