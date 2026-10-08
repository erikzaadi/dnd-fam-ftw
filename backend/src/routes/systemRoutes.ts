import { Router } from 'express';
import type { getConfig } from '../config/env.js';
import { resolveTtsTarget } from '../services/ttsTarget.js';

interface SystemRoutesOptions {
  config: ReturnType<typeof getConfig>;
  hasCloudAI: boolean;
}

export const createSystemRouter = ({ config, hasCloudAI }: SystemRoutesOptions) => {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.json({ status: 'ok', version: config.APP_VERSION });
  });

  router.get('/capabilities', (_req, res) => {
    const ttsTarget = resolveTtsTarget();
    res.json({
      hasCloudAI,
      // Key presence only: this never proves the provider or model is reachable.
      hasTts: !!process.env.OPENAI_API_KEY,
      ttsLegacyModel: ttsTarget.legacyModel,
      ttsVoices: ttsTarget.voices,
    });
  });

  return router;
};
