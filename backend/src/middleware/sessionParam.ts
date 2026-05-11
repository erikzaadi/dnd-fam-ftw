import type { NextFunction, Request, Response, Router } from 'express';
import { StateService } from '../services/stateService.js';

export function registerSessionIdParam(router: Router, paramName: string = 'id'): void {
  router.param(paramName, (req: Request, res: Response, next: NextFunction, sessionId: string) => {
    void loadSessionForNamespace(req, res, next, sessionId);
  });
}

async function loadSessionForNamespace(req: Request, res: Response, next: NextFunction, sessionId: string): Promise<void> {
  try {
    const sessionNamespace = StateService.getSessionNamespaceId(sessionId);
    if (!sessionNamespace || sessionNamespace !== req.namespaceId) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const session = await StateService.getSession(sessionId);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    req.session = session;
    next();
  } catch (error) {
    next(error);
  }
}
