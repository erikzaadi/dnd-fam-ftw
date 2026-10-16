import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.join(import.meta.dirname, '../../.env') });

import { assertAuthConfig, getConfig, getTurnStrategy, isAuthEnabled, isGoogleAuthConfigured, isMcpEnabled, isMcpOAuthEnabled, memberInvitesUnavailableReason } from './config/env.js';
import { getDb, runInTransaction, initializeDatabase } from './persistence/database.js';
import { seedOnboarding } from './scripts/seedOnboarding.js';
import { countUnresolvedOwners } from './realms/ownershipReport.js';
import { startEmailAuthMaintenance } from './services/emailAuthService.js';
import { startDeviceMaintenance } from './services/devicePairingService.js';
import { startOutboxDispatcher } from './services/emailService.js';
import { getImageStorageProvider } from './providers/storage/storageProviderFactory.js';
import { assertTierRequestSettings, getOpenAIMaxRetries } from './providers/ai/openAiClient.js';
import { reconcileInterruptedOperations } from './services/sessionOperationService.js';
import { createApp } from './app.js';
import { accountService } from './services/accountService.js';
import { retiringTtsModelWarning } from './services/ttsTarget.js';

const PORT = process.env.PORT || 3001;
const isProduction = process.env.NODE_ENV === 'production';
const config = getConfig();

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

// Narration is optional, so a retiring TTS override warns instead of failing startup.
const ttsWarning = retiringTtsModelWarning();
if (ttsWarning) {
  console.warn(ttsWarning);
}

// AI callers catch request errors and fall back, so an invalid request
// setting would otherwise degrade quietly on every call. Fail at startup.
try {
  assertAuthConfig(isProduction);
  assertTierRequestSettings();
  getOpenAIMaxRetries();
  console.log(`[Config] Turn strategy: ${getTurnStrategy()}`);
} catch (err) {
  console.error(`FATAL: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

// Bootstrap admin user if ADMIN_EMAIL is set and auth is enabled
initializeDatabase();
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
    accountService.ensureAdminUser(config.ADMIN_EMAIL);
  }
  const invitesOff = memberInvitesUnavailableReason();
  console.log(`[Invites] Member invitations ${invitesOff ? `off (${invitesOff})` : 'on'}`);
  const unresolvedOwners = countUnresolvedOwners();
  if (unresolvedOwners > 0) {
    console.warn(`[Auth] ${unresolvedOwners} namespace(s) without a valid owner; see npm run cli -- namespaces owners`);
  }
  startEmailAuthMaintenance();
  startDeviceMaintenance();
  startOutboxDispatcher();
} else {
  console.log('[Auth] Disabled (AUTH_MODE=disabled) - all requests use the local namespace');
}
console.log(`[MCP] ${isMcpEnabled() ? `Enabled at /mcp (personal access tokens${isMcpOAuthEnabled() ? ' + OAuth sign-in' : ''})` : 'Disabled'}`);

const app = createApp({ config, hasCloudAI, isProduction });

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
