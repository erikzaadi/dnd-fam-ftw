import { describe, expect, it } from 'vitest';
import { migrateStoredTtsSettings } from './useTtsSettings';

describe('migrateStoredTtsSettings', () => {
  it('moves the old default voice to the new default', () => {
    const settings = migrateStoredTtsSettings({ enabled: true, openAiVoice: 'cedar' });

    expect(settings.openAiVoice).toBe('ash');
    expect(settings.openAiVoiceChosen).toBe(false);
    expect(settings.enabled).toBe(true);
  });

  it('keeps a voice that could only have been picked', () => {
    const settings = migrateStoredTtsSettings({ openAiVoice: 'fable' });

    expect(settings.openAiVoice).toBe('fable');
    expect(settings.openAiVoiceChosen).toBe(true);
  });

  it('keeps cedar once the player has chosen it', () => {
    const settings = migrateStoredTtsSettings({ openAiVoice: 'cedar', openAiVoiceChosen: true });

    expect(settings.openAiVoice).toBe('cedar');
    expect(settings.openAiVoiceChosen).toBe(true);
  });

  it('uses the default voice for settings saved before AI narration existed', () => {
    const settings = migrateStoredTtsSettings({ enabled: false });

    expect(settings.openAiVoice).toBe('ash');
    expect(settings.openAiVoiceChosen).toBe(false);
  });

  it('still renames the old gender hint setting', () => {
    const settings = migrateStoredTtsSettings({ preferredGenderHint: 'female' });

    expect(settings.browserGenderHint).toBe('female');
    expect('preferredGenderHint' in settings).toBe(false);
  });
});
