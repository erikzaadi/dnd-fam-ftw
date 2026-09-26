import { describe, expect, it } from 'vitest';
import type { McpPrincipal } from '../services/accessTokenService.js';
import { principalKey } from './toolSupport.js';

const principal = (grantId: string, credential: McpPrincipal['credential']): McpPrincipal => ({
  grantId, credential, userId: 'u', email: 'e@example.com', namespaceId: 'ns', scopes: ['adventures:read', 'adventures:play'], expiresAt: Date.now() + 1000,
});

describe('principalKey', () => {
  it('keeps the personal token key unchanged', () => {
    expect(principalKey(principal('tok1', { kind: 'pat', id: 'tok1' }))).toBe('mcp:tok1');
  });

  it('is the same for rotated access tokens of one grant, so previews survive rotation', () => {
    const first = principalKey(principal('grant1', { kind: 'oauth', id: 'access-1' }));
    expect(principalKey(principal('grant1', { kind: 'oauth', id: 'access-2' }))).toBe(first);
    expect(principalKey(principal('grant2', { kind: 'oauth', id: 'access-1' }))).not.toBe(first);
  });
});
