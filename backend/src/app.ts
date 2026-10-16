import path from 'path';
import fs from 'fs';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { isAllowedOrigin, type AppConfig } from './config/env.js';
import { authMiddleware } from './middleware/auth.js';
import { createAuthRouter } from './routes/authRoutes.js';
import { createDeviceAuthRouter } from './routes/deviceAuthRoutes.js';
import { createInvitationAuthRouter, createNamespaceInviteRouter } from './routes/namespaceInviteRoutes.js';
import { createEventsRouter } from './routes/eventsRoutes.js';
import { createGameRouter } from './routes/gameRoutes.js';
import { createNamespaceRouter } from './routes/namespaceRoutes.js';
import { createSettingsRouter } from './routes/settingsRoutes.js';
import { createSystemRouter } from './routes/systemRoutes.js';
import { createTtsRouter } from './routes/ttsRoutes.js';
import { createWebhookRouter } from './routes/webhookRoutes.js';
import { createAccessTokenRouter } from './routes/accessTokenRoutes.js';
import { createOAuthConsentRouter } from './routes/oauthConsentRoutes.js';
import { createMcpRouter } from './mcp/server.js';

interface AppOptions {
  config: AppConfig;
  hasCloudAI: boolean;
  isProduction: boolean;
}

// Middleware and routes, without startup side effects, so tests can build the real app.
export function createApp({ config, hasCloudAI, isProduction }: AppOptions): express.Express {
  const app = express();

  // nginx on the same host is the only proxy hop; req.ip is the real client address.
  app.set('trust proxy', 'loopback');
  // Credentialed CORS only for the configured frontend origin (and localhost in dev).
  // Unknown origins get no CORS headers, so browsers refuse to share responses with them.
  app.use(cors({
    credentials: true,
    origin: (origin, callback) => callback(null, isAllowedOrigin(origin, isProduction)),
    // Every API call carries X-Namespace-Id, so cross-origin deployments preflight
    // even GETs. Let browsers cache the preflight instead of repeating it per request.
    maxAge: 600,
  }));
  app.use(express.json());
  app.use(cookieParser());

  if (process.env.NODE_ENV !== 'production') {
    app.use((req, res, next) => {
      const start = Date.now();
      res.on('finish', () => {
        console.log(`[${req.method}] ${req.path} ${res.statusCode} ${Date.now() - start}ms`);
      });
      next();
    });
  }

  app.use((_req, res, next) => {
    res.setHeader('X-App-Version', config.APP_VERSION);
    next();
  });

  const generatedDir = path.resolve(config.LOCAL_IMAGE_STORAGE_PATH);
  fs.mkdirSync(generatedDir, { recursive: true });
  app.use(config.LOCAL_IMAGE_PUBLIC_BASE_URL, express.static(generatedDir));

  app.use(createSystemRouter({ config, hasCloudAI }));
  app.use(createAuthRouter({ isProduction }));
  app.use(createDeviceAuthRouter({ isProduction }));
  app.use(createInvitationAuthRouter({ isProduction }));
  app.use(createTtsRouter());
  app.use(createWebhookRouter());
  // Bearer personal access tokens only; never the website cookie middleware below.
  app.use(createMcpRouter());

  // Apply auth middleware to all routes except /auth/* and /health.
  app.use((req, res, next) => {
    if (req.path.startsWith('/auth/') || req.path === '/health') {
      next();
      return;
    }
    authMiddleware(req, res, next);
  });

  app.use(createNamespaceRouter());
  app.use(createNamespaceInviteRouter());
  app.use(createAccessTokenRouter({ isProduction }));
  app.use(createOAuthConsentRouter({ isProduction }));
  app.use(createEventsRouter());
  app.use(createSettingsRouter());
  app.use(createGameRouter());

  return app;
}
