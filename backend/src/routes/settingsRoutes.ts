import { Router } from 'express';
import { z } from 'zod';
import { SettingsService } from '../services/settingsService.js';
import { parseBody } from './routeValidation.js';
import { denyDeviceSessions } from '../middleware/auth.js';

const settingsBodySchema = z.object({
  imagesEnabled: z.boolean().optional(),
});

export const createSettingsRouter = () => {
  const router = Router();

  router.get('/settings', (req, res) => {
    res.json(SettingsService.get(req.namespaceId));
  });
  
  router.post('/settings', denyDeviceSessions, async (req, res) => {
    const body = parseBody(req, res, settingsBodySchema);
    if (!body) {
      return;
    }
    const settings = SettingsService.save(req.namespaceId, body);
    res.json(settings);
  });

  return router;
};
