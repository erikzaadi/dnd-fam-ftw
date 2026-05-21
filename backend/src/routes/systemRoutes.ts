import { Router } from 'express';
import type { getConfig } from '../config/env.js';

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
    const ttsModel = process.env.OPENAI_MODEL_TTS ?? 'gpt-4o-mini-tts';
    res.json({
      hasCloudAI,
      hasTts: !!process.env.OPENAI_API_KEY,
      ttsLegacyModel: ttsModel === 'tts-1' || ttsModel === 'tts-1-hd',
    });
  });

  return router;
};
