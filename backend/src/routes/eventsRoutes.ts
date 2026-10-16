import { Router } from 'express';
import { stillHasAccess } from '../middleware/auth.js';
import { registerSessionIdParam } from '../middleware/sessionParam.js';
import { registerSessionEventStream, registerSessionListEventStream } from '../realtime/sessionEvents.js';

export const createEventsRouter = () => {
  const router = Router();
  registerSessionIdParam(router);

  router.get('/session/:id/events', (req, res) => {
    registerSessionEventStream(req, res, req.params.id, () => stillHasAccess(req));
  });

  router.get('/sessions/events', (req, res) => {
    registerSessionListEventStream(req, res, req.namespaceId, () => stillHasAccess(req));
  });

  return router;
};
