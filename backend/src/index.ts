import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
dotenv.config({ path: path.join(import.meta.dirname, '../../.env') });

import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { assertAuthConfig, getConfig, getTurnStrategy, isAllowedOrigin, isAuthEnabled, isGoogleAuthConfigured, isMcpEnabled } from './config/env.js';
import { authMiddleware } from './middleware/auth.js';
import { getDb, runInTransaction } from './persistence/database.js';
import { seedOnboarding } from './scripts/seedOnboarding.js';
import { countUnresolvedOwners } from './services/namespaceOwnershipService.js';
import { usageAdmissionMiddleware } from './middleware/usageAdmission.js';
import { startEmailAuthMaintenance } from './services/emailAuthService.js';
import { startOutboxDispatcher } from './services/emailService.js';
import { getImageStorageProvider } from './providers/storage/storageProviderFactory.js';
import { getOpenAIMaxRetries, getPreviewReasoningEffort } from './providers/ai/openAiClient.js';
import { StateService } from './services/stateService.js';
import { reconcileInterruptedOperations } from './services/sessionOperationService.js';
import { createAuthRouter } from './routes/authRoutes.js';
import { createInvitationAuthRouter, createNamespaceInviteRouter } from './routes/namespaceInviteRoutes.js';
import { createEventsRouter } from './routes/eventsRoutes.js';
import { createGameRouter } from './routes/gameRoutes.js';
import { createNamespaceRouter } from './routes/namespaceRoutes.js';
import { createSettingsRouter } from './routes/settingsRoutes.js';
import { createSystemRouter } from './routes/systemRoutes.js';
import { createTtsRouter } from './routes/ttsRoutes.js';
import { createWebhookRouter } from './routes/webhookRoutes.js';
import { createAccessTokenRouter } from './routes/accessTokenRoutes.js';
import { createMcpRouter } from './mcp/server.js';

const app = express();
const PORT = process.env.PORT || 3001;
const isProduction = process.env.NODE_ENV === 'production';

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
      console.log(`[${req.method}] ${req.path} ${res.statusCode} — ${Date.now() - start}ms`);
    });
    next();
  });
}

const config = getConfig();
app.use((_req, res, next) => {
  res.setHeader('X-App-Version', config.APP_VERSION);
  next();
});

const generatedDir = path.resolve(config.LOCAL_IMAGE_STORAGE_PATH);
fs.mkdirSync(generatedDir, { recursive: true });
app.use(config.LOCAL_IMAGE_PUBLIC_BASE_URL, express.static(generatedDir));

const deprecatedAiEnvVars = [
  'AI_NARRATION_PROVIDER',
  'AI_IMAGE_PROVIDER',
  'LOCALAI_BASE_URL',
  'LOCALAI_NARRATION_MODEL',
  'LOCALAI_IMAGE_BASE_URL',
  'LOCALAI_IMAGE_MODEL',
  'LOCALAI_IMAGE_STEPS',
  'GEMINI_API_KEY',
  'GEMINI_IMAGE_MODEL',
].filter(name => process.env[name]);
if (deprecatedAiEnvVars.length > 0) {
  console.warn(`[Config] Ignoring deprecated provider env vars: ${deprecatedAiEnvVars.join(', ')}`);
}

const hasCloudAI = !!process.env.OPENAI_API_KEY;
if (!hasCloudAI && process.env.NODE_ENV !== 'test' && process.env.TEST_AI_MOCK !== 'true') {
  console.error('FATAL: OpenAI-compatible AI is not configured. Set OPENAI_API_KEY.');
  process.exit(1);
}

// Preview callers catch request errors and fall back, so an invalid request
// setting would otherwise degrade quietly on every call. Fail at startup.
try {
  assertAuthConfig(isProduction);
  getPreviewReasoningEffort();
  getOpenAIMaxRetries();
  console.log(`[Config] Turn strategy: ${getTurnStrategy()}`);
} catch (err) {
  console.error(`FATAL: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

// Bootstrap admin user if ADMIN_EMAIL is set and auth is enabled
StateService.initialize();
// Quick start ("Get me rollin'") copies this template; recreate it on every start so it
// exists in every database and matches the current seed.
try {
  runInTransaction(() => seedOnboarding(getDb()));
} catch (err) {
  console.error(`[Seed] Could not prepare the onboarding template: ${err instanceof Error ? err.message : String(err)}`);
}
// Operations still pending from a previous process never committed; fail them
// explicitly so clients stop waiting and can retry as a new operation.
reconcileInterruptedOperations();
if (isAuthEnabled()) {
  console.log(`[Auth] Enabled (signup: ${config.SIGNUP_MODE}, google: ${isGoogleAuthConfigured() ? 'on' : 'off'}, email: ${config.EMAIL_PROVIDER})`);
  if (config.ADMIN_EMAIL) {
    StateService.ensureAdminUser(config.ADMIN_EMAIL);
  }
  const unresolvedOwners = countUnresolvedOwners();
  if (unresolvedOwners > 0) {
    console.warn(`[Auth] ${unresolvedOwners} namespace(s) without a valid owner; see npm run cli -- namespaces owners`);
  }
  startEmailAuthMaintenance();
  startOutboxDispatcher();
} else {
  console.log('[Auth] Disabled (AUTH_MODE=disabled) - all requests use the local namespace');
}
console.log(`[MCP] ${isMcpEnabled() ? 'Enabled at /mcp (personal access tokens, pilot users only)' : 'Disabled'}`);

app.use(createSystemRouter({ config, hasCloudAI }));
app.use(createAuthRouter({ isProduction }));
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
app.use(usageAdmissionMiddleware);

app.use(createNamespaceRouter());
app.use(createNamespaceInviteRouter());
app.use(createAccessTokenRouter({ isProduction }));
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
