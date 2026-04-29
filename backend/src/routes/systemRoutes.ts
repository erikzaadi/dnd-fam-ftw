import { Router } from 'express';
import type { getConfig } from '../config/env.js';

interface SystemRoutesOptions {
  config: ReturnType<typeof getConfig>;
  hasLocalAI: boolean;
  hasCloudAI: boolean;
}

export const createSystemRouter = ({ config, hasLocalAI, hasCloudAI }: SystemRoutesOptions) => {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.json({ status: 'ok', version: config.APP_VERSION });
  });

  router.get('/capabilities', (_req, res) => {
    res.json({ hasLocalAI, hasCloudAI, hasTts: !!process.env.OPENAI_API_KEY });
  });

  return router;
};
