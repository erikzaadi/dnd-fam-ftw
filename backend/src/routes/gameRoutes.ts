import { Router } from 'express';
import { createCharacterRouter } from './characterRoutes.js';
import { createSessionRouter } from './sessionRoutes.js';
import { createStatSuggestionRouter } from './statSuggestionRoutes.js';
import { createTurnRouter } from './turnRoutes.js';

export const createGameRouter = () => {
  const router = Router();

  router.use(createSessionRouter());
  router.use(createStatSuggestionRouter());
  router.use(createCharacterRouter());
  router.use(createTurnRouter());

  return router;
};
