import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
dotenv.config({ path: path.join(import.meta.dirname, '../../.env') });

import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { getConfig, isAuthEnabled } from './config/env.js';
import { authMiddleware } from './middleware/auth.js';
import { getImageStorageProvider } from './providers/storage/storageProviderFactory.js';
import { StateService } from './services/stateService.js';
import { createAuthRouter } from './routes/authRoutes.js';
import { createEventsRouter } from './routes/eventsRoutes.js';
import { createGameRouter } from './routes/gameRoutes.js';
import { createNamespaceRouter } from './routes/namespaceRoutes.js';
import { createSettingsRouter } from './routes/settingsRoutes.js';
import { createSystemRouter } from './routes/systemRoutes.js';
import { createTtsRouter } from './routes/ttsRoutes.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ credentials: true, origin: true }));
app.use(express.json());
app.use(cookieParser());

const config = getConfig();
const isProduction = process.env.NODE_ENV === 'production';
app.use((_req, res, next) => {
  res.setHeader('X-App-Version', config.APP_VERSION);
  next();
});

const generatedDir = path.resolve(config.LOCAL_IMAGE_STORAGE_PATH);
fs.mkdirSync(generatedDir, { recursive: true });
app.use(config.LOCAL_IMAGE_PUBLIC_BASE_URL, express.static(generatedDir));

// Require at least one AI provider to be configured
const hasLocalAI = !!(process.env.LOCALAI_BASE_URL || process.env.AI_NARRATION_PROVIDER === 'localai');
const hasCloudAI = !!(process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY);
if (!hasLocalAI && !hasCloudAI) {
  console.error('FATAL: No AI provider configured. Set OPENAI_API_KEY, GEMINI_API_KEY, or LOCALAI_BASE_URL.');
  process.exit(1);
}

// Bootstrap admin user if ADMIN_EMAIL is set and auth is enabled
StateService.initialize();
if (isAuthEnabled()) {
  console.log(`[Auth] Enabled - Google OAuth active, callback: ${config.GOOGLE_CALLBACK_URL}`);
  if (config.ADMIN_EMAIL) {
    StateService.ensureAdminUser(config.ADMIN_EMAIL);
  }
} else {
  console.log('[Auth] Disabled - no GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET/JWT_SECRET in env, all requests use local namespace');
}

app.use(createSystemRouter({ config, hasLocalAI, hasCloudAI }));
app.use(createAuthRouter({ isProduction }));
app.use(createTtsRouter());

// Apply auth middleware to all routes except /auth/* and /health.
app.use((req, res, next) => {
  if (req.path.startsWith('/auth/') || req.path === '/health') {
    next();
    return;
  }
  authMiddleware(req, res, next);
});

app.use(createNamespaceRouter());
app.use(createEventsRouter());
app.use(createSettingsRouter());
app.use(createGameRouter());

async function startup() {
  console.log(`[Config] Persistence: sqlite @ ${config.SQLITE_DB_PATH}`);
  console.log(`[Config] Image storage: ${config.IMAGE_STORAGE_PROVIDER}`);

  if (config.IMAGE_STORAGE_PROVIDER === 's3') {
    const provider = getImageStorageProvider();
    if (provider.validateSetup) {
      await provider.validateSetup();
    }
  }

  app.listen(PORT, () => {
    console.log(`Backend listening on port ${PORT}`);
  });
}

startup().catch(err => {
  console.error('[Startup] Fatal error:', err);
  process.exit(1);
});
