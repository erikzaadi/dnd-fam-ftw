import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  FIRST_RUN_WIZARD_VERSION,
  isFirstRunWizardCurrent,
  loadFirstRunPreferences,
  markFirstRunWizardCompleted,
  markFirstRunWizardSkipped,
  saveFirstRunPreferences,
} from './firstRunPreferences';

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-05-10T12:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('firstRunPreferences', () => {
  it('marks the current wizard version completed', () => {
    const record = markFirstRunWizardCompleted();

    expect(record.completedVersion).toBe(FIRST_RUN_WIZARD_VERSION);
    expect(record.completedAt).toBe('2026-05-10T12:00:00.000Z');
    expect(isFirstRunWizardCurrent(record)).toBe(true);
  });

  it('marks the current wizard version skipped', () => {
    const record = markFirstRunWizardSkipped();

    expect(record.skippedVersion).toBe(FIRST_RUN_WIZARD_VERSION);
    expect(record.skippedAt).toBe('2026-05-10T12:00:00.000Z');
    expect(isFirstRunWizardCurrent(record)).toBe(true);
  });

  it('persists a preferred game mode', () => {
    saveFirstRunPreferences({ preferredGameMode: 'zug-ma-geddon' });

    expect(loadFirstRunPreferences().preferredGameMode).toBe('zug-ma-geddon');
  });

  it('falls back to balanced for invalid stored game modes', () => {
    localStorage.setItem('dnd-first-run-preferences', JSON.stringify({ preferredGameMode: 'bad-mode' }));

    expect(loadFirstRunPreferences().preferredGameMode).toBe('balanced');
  });
});
