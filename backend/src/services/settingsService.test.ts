import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const allFn = vi.fn<() => { key: string; value: string }[]>(() => []);
  const prepare = vi.fn(() => ({ all: allFn }));
  const exec = vi.fn();
  const Database = vi.fn(function DatabaseMock() {
    return { exec, prepare };
  });
  return { Database, prepare, exec, allFn };
});

vi.mock('libsql', () => ({
  default: mocks.Database,
}));

import { SettingsService } from './settingsService.js';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.allFn.mockReturnValue([]);
});

describe('SettingsService', () => {
  it('returns defaults when the database has no stored settings', () => {
    const settings = SettingsService.get();
    expect(settings).toEqual({ imagesEnabled: true });
  });

  it('does not include defaultUseLocalAI in returned settings', () => {
    const settings = SettingsService.get();
    expect(settings).not.toHaveProperty('defaultUseLocalAI');
  });

  it('returns stored imagesEnabled=false when persisted in the database', () => {
    mocks.allFn.mockReturnValue([{ key: 'imagesEnabled', value: 'false' }]);
    const settings = SettingsService.get();
    expect(settings.imagesEnabled).toBe(false);
  });
});
