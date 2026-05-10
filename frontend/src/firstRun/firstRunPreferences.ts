import type { GameMode } from '../types';

export const FIRST_RUN_WIZARD_VERSION = 1;

const WIZARD_STORAGE_KEY = 'dnd-first-run-wizard';
const PREFERENCES_STORAGE_KEY = 'dnd-first-run-preferences';

export type FirstRunWizardRecord = {
  completedVersion?: number;
  completedAt?: string;
  skippedVersion?: number;
  skippedAt?: string;
};

export type FirstRunPreferences = {
  preferredGameMode: GameMode;
};

const DEFAULT_PREFERENCES: FirstRunPreferences = {
  preferredGameMode: 'balanced',
};

const GAME_MODES = new Set<GameMode>(['cinematic', 'balanced', 'fast', 'zug-ma-geddon']);

function readJson<T>(key: string, fallback: T): T {
  const stored = localStorage.getItem(key);
  if (!stored) {
    return fallback;
  }
  try {
    return { ...fallback, ...JSON.parse(stored) } as T;
  } catch {
    return fallback;
  }
}

export function loadFirstRunWizardRecord(): FirstRunWizardRecord {
  return readJson<FirstRunWizardRecord>(WIZARD_STORAGE_KEY, {});
}

export function isFirstRunWizardCurrent(record = loadFirstRunWizardRecord()): boolean {
  return (record.completedVersion ?? 0) >= FIRST_RUN_WIZARD_VERSION ||
    (record.skippedVersion ?? 0) >= FIRST_RUN_WIZARD_VERSION;
}

export function markFirstRunWizardCompleted(): FirstRunWizardRecord {
  const next: FirstRunWizardRecord = {
    ...loadFirstRunWizardRecord(),
    completedVersion: FIRST_RUN_WIZARD_VERSION,
    completedAt: new Date().toISOString(),
  };
  localStorage.setItem(WIZARD_STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function markFirstRunWizardSkipped(): FirstRunWizardRecord {
  const next: FirstRunWizardRecord = {
    ...loadFirstRunWizardRecord(),
    skippedVersion: FIRST_RUN_WIZARD_VERSION,
    skippedAt: new Date().toISOString(),
  };
  localStorage.setItem(WIZARD_STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function loadFirstRunPreferences(): FirstRunPreferences {
  const stored = readJson<FirstRunPreferences>(PREFERENCES_STORAGE_KEY, DEFAULT_PREFERENCES);
  return {
    ...stored,
    preferredGameMode: GAME_MODES.has(stored.preferredGameMode) ? stored.preferredGameMode : DEFAULT_PREFERENCES.preferredGameMode,
  };
}

export function saveFirstRunPreferences(patch: Partial<FirstRunPreferences>): FirstRunPreferences {
  const next = { ...loadFirstRunPreferences(), ...patch };
  localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(next));
  return next;
}
