import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { getConfig, isAllowedOrigin, isAuthEnabled } from '../config/env.js';
import { getUsageContext } from '../lib/usageContext.js';
import { StateService } from '../services/stateService.js';
import { accessTokenService, isMcpEligible, MAX_ACTIVE_TOKENS_PER_USER, type CreateTokenResult } from '../services/accessTokenService.js';
import { ACCESS_TOKEN_SCOPE_VALUES, type AccessTokenCreatedResponse, type AccessTokenListResponse, type AutoConfirmListResponse } from '../types.js';
import { autoConfirmRepository } from '../repositories/autoConfirmRepository.js';
import { sessionRepository } from '../repositories/sessionRepository.js';
import { parseBody } from './routeValidation.js';

const createTokenBodySchema = z.object({
  label: z.string().trim().min(1).max(60),
  scopes: z.array(z.enum(ACCESS_TOKEN_SCOPE_VALUES)).max(ACCESS_TOKEN_SCOPE_VALUES.length),
}).strict();

const autoConfirmBodySchema = z.object({
  enabled: z.boolean(),
}).strict();

const AUTO_CONFIRM_LIST_LIMIT = 100;

const CREATE_ERRORS: Record<Exclude<CreateTokenResult, { ok: true }>['error'], { status: number; message: string }> = {
  not_eligible: { status: 403, message: 'Assistant access is not enabled for your account.' },
  not_member: { status: 403, message: 'You are no longer a member of this realm.' },
  too_many_tokens: { status: 409, message: `You can have at most ${MAX_ACTIVE_TOKENS_PER_USER} active tokens. Revoke one first.` },
  not_found: { status: 404, message: 'Token not found or no longer active.' },
};

// Access tokens page: mint, list, rotate, and revoke MCP personal access tokens.
// Mounted behind the cookie authMiddleware, so only a current full website session
// for a namespace member reaches these handlers. MCP tokens cannot call them.
export const createAccessTokenRouter = ({ isProduction }: { isProduction: boolean }) => {
  const router = Router();

  // Minting a credential needs a browser request from our own frontend. Browsers always
  // send Origin on cross-origin and same-origin POSTs made with fetch.
  const requireOwnOrigin = (req: Request, res: Response, next: NextFunction) => {
    if (!isAllowedOrigin(req.get('origin'), isProduction)) {
      res.status(403).json({ error: 'Origin not allowed' });
      return;
    }
    next();
  };

  const requireUser = (_req: Request, res: Response, next: NextFunction) => {
    if (!isAuthEnabled() || !getUsageContext()?.userId) {
      res.status(404).json({ error: 'Access tokens need sign-in' });
      return;
    }
    next();
  };

  const sendCreated = (res: Response, result: CreateTokenResult) => {
    if (!result.ok) {
      const error = CREATE_ERRORS[result.error];
      res.status(error.status).json({ error: result.error, message: error.message });
      return;
    }
    const body: AccessTokenCreatedResponse = { token: result.token, secret: result.secret };
    res.setHeader('Cache-Control', 'no-store');
    res.status(201).json(body);
  };

  router.get('/access-tokens', requireUser, (req, res) => {
    const userId = getUsageContext()!.userId!;
    const eligible = isMcpEligible(userId);
    const body: AccessTokenListResponse = {
      eligible,
      mcpUrl: eligible ? getConfig().MCP_PUBLIC_URL : null,
      namespaceName: StateService.getNamespaceById(req.namespaceId)?.name ?? null,
      maxActiveTokens: MAX_ACTIVE_TOKENS_PER_USER,
      // Listed even after pilot access ends, so old tokens can still be revoked.
      tokens: accessTokenService.list(userId),
    };
    res.json(body);
  });

  router.post('/access-tokens', requireOwnOrigin, requireUser, (req, res) => {
    const body = parseBody(req, res, createTokenBodySchema);
    if (!body) {
      return;
    }
    const userId = getUsageContext()!.userId!;
    // The token is for the realm the user is signed in to right now.
    const result = accessTokenService.create({ userId, namespaceId: req.namespaceId, label: body.label, scopes: body.scopes });
    if (result.ok) {
      console.log(`[MCP] Token ${result.token.id} created for user ${userId} namespace ${req.namespaceId}`);
    }
    sendCreated(res, result);
  });

  router.post('/access-tokens/:tokenId/rotate', requireOwnOrigin, requireUser, (req, res) => {
    const userId = getUsageContext()!.userId!;
    const result = accessTokenService.rotate(userId, req.params.tokenId as string);
    if (result.ok) {
      console.log(`[MCP] Token ${req.params.tokenId as string} rotated to ${result.token.id} for user ${userId}`);
    }
    sendCreated(res, result);
  });

  router.post('/access-tokens/:tokenId/revoke', requireOwnOrigin, requireUser, (req, res) => {
    const userId = getUsageContext()!.userId!;
    if (!accessTokenService.revoke(userId, req.params.tokenId as string)) {
      res.status(404).json({ error: 'not_found', message: CREATE_ERRORS.not_found.message });
      return;
    }
    console.log(`[MCP] Token ${req.params.tokenId as string} revoked by user ${userId}`);
    res.json({ ok: true });
  });

  // MCP Undo window for clean actions, per player and adventure (on by default). Only
  // this website setting changes it; no MCP tool can.
  router.get('/access-tokens/auto-confirm', requireUser, (req, res) => {
    const userId = getUsageContext()!.userId!;
    const alwaysAsk = autoConfirmRepository.disabledSessionIds(userId);
    const body: AutoConfirmListResponse = {
      adventures: sessionRepository.listAdventureSummaries(req.namespaceId, AUTO_CONFIRM_LIST_LIMIT, 0)
        .map(row => ({ id: row.id, title: row.displayName, enabled: !alwaysAsk.has(row.id) })),
    };
    res.json(body);
  });

  router.post('/access-tokens/auto-confirm/:sessionId', requireOwnOrigin, requireUser, (req, res) => {
    const body = parseBody(req, res, autoConfirmBodySchema);
    if (!body) {
      return;
    }
    const userId = getUsageContext()!.userId!;
    const sessionId = req.params.sessionId as string;
    if (StateService.getSessionNamespaceId(sessionId) !== req.namespaceId) {
      res.status(404).json({ error: 'not_found', message: 'Adventure not found.' });
      return;
    }
    if (body.enabled && !isMcpEligible(userId)) {
      res.status(403).json({ error: 'not_eligible', message: CREATE_ERRORS.not_eligible.message });
      return;
    }
    autoConfirmRepository.set(userId, sessionId, body.enabled, Date.now());
    res.json({ id: sessionId, enabled: body.enabled });
  });

  return router;
};
