import { Router } from 'express';
import { createCharacterRouter } from './characterRoutes.js';
import { createSessionRouter } from './sessionRoutes.js';
import { createStatSuggestionRouter } from './statSuggestionRoutes.js';
import { createTurnRouter } from './turnRoutes.js';
import { createAdventureRouter } from './adventureRoutes.js';
import { createIdeasRouter } from './ideasRoutes.js';
import { createAskRouter } from './askRoutes.js';

export const createGameRouter = () => {
  const router = Router();

  router.use(createSessionRouter());
  router.use(createStatSuggestionRouter());
  router.use(createCharacterRouter());
  router.use(createTurnRouter());
  router.use(createAdventureRouter());
  router.use(createIdeasRouter());
  router.use(createAskRouter());

  return router;
};
