import { afterEach, describe, expect, it, vi } from 'vitest';
import { getConfig, isAllowedOrigin, resetConfigForTests } from './env.js';

const mcpEnabledWith = (env: Record<string, string | undefined>) => {
  for (const [name, value] of Object.entries(env)) {
    vi.stubEnv(name, value);
  }
  resetConfigForTests();
  return getConfig().MCP_ENABLED;
};

afterEach(() => {
  vi.unstubAllEnvs();
  resetConfigForTests();
});

describe('MCP_ENABLED default', () => {
  it('is on for local development with auth', () => {
    expect(mcpEnabledWith({ AUTH_MODE: 'enabled', NODE_ENV: 'development', MCP_ENABLED: '' })).toBe(true);
  });

  it('is off in production, in tests, and without auth', () => {
    expect(mcpEnabledWith({ AUTH_MODE: 'enabled', NODE_ENV: 'production', MCP_ENABLED: '' })).toBe(false);
    expect(mcpEnabledWith({ AUTH_MODE: 'enabled', NODE_ENV: 'test', MCP_ENABLED: '' })).toBe(false);
    expect(mcpEnabledWith({ AUTH_MODE: 'disabled', NODE_ENV: 'development', MCP_ENABLED: '' })).toBe(false);
  });

  it('follows an explicit value', () => {
    expect(mcpEnabledWith({ AUTH_MODE: 'enabled', NODE_ENV: 'development', MCP_ENABLED: 'false' })).toBe(false);
    expect(mcpEnabledWith({ AUTH_MODE: 'enabled', NODE_ENV: 'production', MCP_ENABLED: 'true' })).toBe(true);
  });
});

describe('isAllowedOrigin outside production', () => {
  // Synthetic edge-of-range addresses, not any real network's.
  it('allows localhost and private network addresses, nothing public', () => {
    for (const origin of ['http://localhost:5173', 'http://10.255.255.254:5173', 'http://172.31.255.254', 'http://192.168.255.254:5173', 'http://tv-box.local:5173']) {
      expect(isAllowedOrigin(origin, false)).toBe(true);
    }
    for (const origin of ['http://172.32.0.1', 'http://192.168.255.254.example.com', 'https://192.168.255.254', 'http://example.com', 'null']) {
      expect(isAllowedOrigin(origin, false)).toBe(false);
    }
    expect(isAllowedOrigin('http://192.168.255.254:5173', true)).toBe(false);
  });
});
