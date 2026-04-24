// Set env vars before any service code uses them.
// getConfig() is lazily cached, so these are picked up on first call.
process.env.JWT_SECRET = 'test-jwt-secret-for-auth-tests-only';
process.env.GOOGLE_CLIENT_ID = 'test-google-client-id';
process.env.GOOGLE_CLIENT_SECRET = 'test-google-client-secret';
process.env.GOOGLE_CALLBACK_URL = 'http://localhost:5173/api/auth/google/callback';

import jwt from 'jsonwebtoken';
import { signJwt, verifyJwt, buildGoogleAuthUrl, getAuthPublicConfig } from './authService.js';

const JWT_SECRET = 'test-jwt-secret-for-auth-tests-only';

console.log('Testing authService...');

// Test 1: signJwt + verifyJwt round-trip
console.log('Test 1: signJwt + verifyJwt round-trip...');
const token = signJwt({ email: 'hero@example.com', namespaceId: 'ns-1' });
const payload = verifyJwt(token);
if (!payload) {
  throw new Error('verifyJwt should return payload for valid token');
}
if (payload.email !== 'hero@example.com') {
  throw new Error(`Expected email 'hero@example.com', got '${payload.email}'`);
}
if (payload.namespaceId !== 'ns-1') {
  throw new Error(`Expected namespaceId 'ns-1', got '${payload.namespaceId}'`);
}
console.log('- Round-trip verified: email and namespaceId match ✓');

// Test 2: signJwt includes optional type field
console.log('Test 2: JWT type field is preserved...');
const pendingToken = signJwt({ email: 'new@example.com', namespaceId: 'ns-2', type: 'pending-namespace' });
const pendingPayload = verifyJwt(pendingToken);
if (!pendingPayload) {
  throw new Error('verifyJwt should return payload');
}
if (pendingPayload.type !== 'pending-namespace') {
  throw new Error(`Expected type 'pending-namespace', got '${pendingPayload.type}'`);
}
console.log(`- type field preserved: ${pendingPayload.type} ✓`);

// Test 3: verifyJwt returns null for a completely invalid token
console.log('Test 3: verifyJwt returns null for garbage token...');
const result = verifyJwt('this.is.not.a.jwt');
if (result !== null) {
  throw new Error('Should return null for garbage token');
}
console.log('- Returns null for garbage ✓');

// Test 4: verifyJwt returns null for a token signed with a different secret
console.log('Test 4: verifyJwt returns null for wrong-secret token...');
const wrongSecretToken = jwt.sign({ email: 'hacker@evil.com', namespaceId: 'ns-hacked' }, 'totally-different-secret');
const wrongResult = verifyJwt(wrongSecretToken);
if (wrongResult !== null) {
  throw new Error('Should return null for token signed with wrong secret');
}
console.log('- Returns null for wrong-secret token ✓');

// Test 5: verifyJwt returns null for an already-expired token
console.log('Test 5: verifyJwt returns null for expired token...');
const expiredToken = jwt.sign(
  { email: 'old@example.com', namespaceId: 'ns-old' },
  JWT_SECRET,
  { expiresIn: -1 }
);
const expiredResult = verifyJwt(expiredToken);
if (expiredResult !== null) {
  throw new Error('Should return null for expired token');
}
console.log('- Returns null for expired token ✓');

// Test 6: short-lived token (shortLived=true) is still verifiable immediately
console.log('Test 6: shortLived token verifies immediately...');
const shortToken = signJwt({ email: 'temp@example.com', namespaceId: 'ns-temp' }, true);
const shortPayload = verifyJwt(shortToken);
if (!shortPayload) {
  throw new Error('Short-lived token should be valid immediately after creation');
}
if (shortPayload.email !== 'temp@example.com') {
  throw new Error(`Expected 'temp@example.com', got '${shortPayload.email}'`);
}
console.log('- Short-lived token valid immediately after signing ✓');

// Test 7: buildGoogleAuthUrl contains required query params
console.log('Test 7: buildGoogleAuthUrl contains required params...');
const authUrl = buildGoogleAuthUrl('csrf-state-token-123');
const parsed = new URL(authUrl);
if (parsed.hostname !== 'accounts.google.com') {
  throw new Error(`Expected accounts.google.com, got '${parsed.hostname}'`);
}
if (parsed.searchParams.get('client_id') !== 'test-google-client-id') {
  throw new Error(`client_id mismatch: ${parsed.searchParams.get('client_id')}`);
}
if (parsed.searchParams.get('redirect_uri') !== 'http://localhost:5173/api/auth/google/callback') {
  throw new Error(`redirect_uri mismatch: ${parsed.searchParams.get('redirect_uri')}`);
}
if (parsed.searchParams.get('response_type') !== 'code') {
  throw new Error('response_type should be code');
}
if (parsed.searchParams.get('state') !== 'csrf-state-token-123') {
  throw new Error(`state mismatch: ${parsed.searchParams.get('state')}`);
}
if (!parsed.searchParams.get('scope')?.includes('email')) {
  throw new Error('scope should include email');
}
console.log('- All required params present in Google auth URL ✓');

// Test 8: getAuthPublicConfig reflects enabled status
console.log('Test 8: getAuthPublicConfig returns enabled=true when keys are set...');
const config = getAuthPublicConfig();
if (!config.enabled) {
  throw new Error('Auth should be enabled when GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET + JWT_SECRET are set');
}
if (config.googleClientId !== 'test-google-client-id') {
  throw new Error(`Expected googleClientId 'test-google-client-id', got '${config.googleClientId}'`);
}
console.log(`- enabled: ${config.enabled}, googleClientId: ${config.googleClientId} ✓`);

// Test 9: all JWT types round-trip correctly
console.log('Test 9: all JWT types sign and verify...');
const types = ['full', 'pending-namespace', 'pending-invite', 'invite-requested'] as const;
for (const type of types) {
  const t = signJwt({ email: `${type}@test.com`, namespaceId: 'ns-type', type });
  const p = verifyJwt(t);
  if (!p) {
    throw new Error(`JWT type '${type}' failed to verify`);
  }
  if (p.type !== type) {
    throw new Error(`Expected type '${type}', got '${p.type}'`);
  }
}
console.log('- All 4 JWT types verified ✓');

console.log('\nAll authService tests passed!');
