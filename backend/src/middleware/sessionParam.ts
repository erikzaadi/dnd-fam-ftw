import type { NextFunction, Request, Response, Router } from 'express';
import { sessionRepository } from '../repositories/sessionRepository.js';
import { setUsageSessionId } from '../lib/usageContext.js';

export function registerSessionIdParam(router: Router, paramName: string = 'id'): void {
  router.param(paramName, (req: Request, res: Response, next: NextFunction, sessionId: string) => {
    void loadSessionForNamespace(req, res, next, sessionId);
  });
}

async function loadSessionForNamespace(req: Request, res: Response, next: NextFunction, sessionId: string): Promise<void> {
  try {
    const sessionNamespace = sessionRepository.getSessionNamespaceId(sessionId);
    if (!sessionNamespace || sessionNamespace !== req.namespaceId) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const session = await sessionRepository.getSession(sessionId);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    req.session = session;
    setUsageSessionId(sessionId);
    next();
  } catch (error) {
    next(error);
  }
}
