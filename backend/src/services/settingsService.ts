import { settingsRepository } from '../repositories/settingsRepository.js';
import type { AppSettings } from '../types.js';

export type { AppSettings };

const DEFAULTS: AppSettings = {
  imagesEnabled: true,
};

// Settings are per namespace: one group's choices never change another group's realms.
export class SettingsService {
  static get(namespaceId: string): AppSettings {
    const rows = settingsRepository.getNamespaceSettings(namespaceId);
    const stored = Object.fromEntries(rows.map(r => [r.key, JSON.parse(r.value)]));
    return {
      ...DEFAULTS,
      ...(typeof stored.imagesEnabled === 'boolean' && { imagesEnabled: stored.imagesEnabled }),
    };
  }

  static save(namespaceId: string, settings: Partial<AppSettings>): AppSettings {
    const next = { ...this.get(namespaceId), ...settings };
    settingsRepository.saveNamespaceSettings(namespaceId, [
      { key: 'imagesEnabled', value: JSON.stringify(next.imagesEnabled) },
    ]);
    return next;
  }
}
