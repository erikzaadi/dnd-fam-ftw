import { Router } from 'express';
import { registerSessionEventStream, registerSessionListEventStream } from '../realtime/sessionEvents.js';

export const createEventsRouter = () => {
  const router = Router();

  router.get('/session/:id/events', (req, res) => {
    registerSessionEventStream(req, res, req.params.id);
  });

  router.get('/sessions/events', (req, res) => {
    registerSessionListEventStream(req, res, req.namespaceId);
  });

  return router;
};
