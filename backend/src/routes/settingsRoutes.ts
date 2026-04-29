import { Router } from 'express';
import asyncHandler from 'express-async-handler';
import { z } from 'zod';
import { SettingsService } from '../services/settingsService.js';
import { parseBody } from './routeValidation.js';

const settingsBodySchema = z.object({
  imagesEnabled: z.boolean().optional(),
  defaultUseLocalAI: z.boolean().optional(),
});

export const createSettingsRouter = () => {
  const router = Router();

  router.get('/settings', (_req, res) => {
    res.json(SettingsService.get());
  });
  
  router.post('/settings', asyncHandler(async (req, res) => {
    const body = parseBody(req, res, settingsBodySchema);
    if (!body) {
      return;
    }
    const settings = SettingsService.save(body);
    res.json(settings);
  }));

  return router;
};
