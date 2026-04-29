import { Router } from 'express';
import asyncHandler from 'express-async-handler';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.js';
import { StateService } from '../services/stateService.js';
import { generateSpeech, normalizeTextForSpeech, TTS_MAX_INPUT_CHARS, type TtsGender } from '../services/ttsService.js';
import { parseBody } from './routeValidation.js';

const ttsBodySchema = z.object({
  text: z.string(),
  gender: z.enum(['male', 'female']).optional(),
});

export const createTtsRouter = () => {
  const router = Router();

  router.post('/tts', authMiddleware, asyncHandler(async (req, res) => {
    if (!process.env.OPENAI_API_KEY) {
      res.status(503).json({ error: 'tts_not_configured', message: 'OpenAI TTS is not configured' });
      return;
    }

    const body = parseBody(req, res, ttsBodySchema);
    if (!body) {
      return;
    }
    const { text, gender } = body;

    const normalized = normalizeTextForSpeech(text);
    if (!normalized) {
      res.status(400).json({ error: 'invalid_request', message: 'text is empty' });
      return;
    }
    if (normalized.length > TTS_MAX_INPUT_CHARS) {
      res.status(413).json({ error: 'text_too_long', message: `text must be ${TTS_MAX_INPUT_CHARS} characters or fewer` });
      return;
    }

    const ttsGender = gender as TtsGender | undefined;
    const audio = await generateSpeech(normalized, ttsGender);
    const namespaceId = req.namespaceId;
    const voice = ttsGender === 'female' ? 'sage' : 'fable';
    setImmediate(() => {
      try {
        StateService.recordTtsUsage(namespaceId, voice, normalized.length);
      } catch (error) {
        console.warn('[TTS] Failed to record usage:', error);
      }
    });
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store');
    res.send(audio);
  }));

  return router;
};
