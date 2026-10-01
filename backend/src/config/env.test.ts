import { afterEach, describe, expect, it, vi } from 'vitest';
import { getConfig, resetConfigForTests } from './env.js';

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
