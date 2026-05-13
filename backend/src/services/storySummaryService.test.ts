import { describe, it, expect } from 'vitest';
import { buildCampaignStateSummaryPrompt, parseEncounterSeeds, StorySummaryService } from './storySummaryService.js';

describe('StorySummaryService.shouldUpdate', () => {
  it('returns false at turn 0', () => {
    expect(StorySummaryService.shouldUpdate(0)).toBe(false);
  });

  it('returns false at turn 1', () => {
    expect(StorySummaryService.shouldUpdate(1)).toBe(false);
  });

  it('returns false for turns 2-4', () => {
    for (const t of [2, 3, 4]) {
      expect(StorySummaryService.shouldUpdate(t)).toBe(false);
    }
  });

  it('returns true at turn 5', () => {
    expect(StorySummaryService.shouldUpdate(5)).toBe(true);
  });

  it('returns true at subsequent interval turns (10, 15, 20)', () => {
    for (const t of [10, 15, 20]) {
      expect(StorySummaryService.shouldUpdate(t)).toBe(true);
    }
  });

  it('returns false between interval turns', () => {
    for (const t of [6, 7, 8, 9, 11, 13]) {
      expect(StorySummaryService.shouldUpdate(t)).toBe(false);
    }
  });
});

describe('parseEncounterSeeds', () => {
  const VALID_SEEDS = JSON.stringify([
    {
      name: 'Thornwood Guardian',
      triggerHint: 'when party enters the Thornwood',
      enemies: [{ name: 'Vine Beast', role: 'standard', weaknesses: [{ label: 'fire', school: 'fire' }] }],
      areas: [{ label: 'Writhing Roots', tags: ['hazard'] }],
      objective: 'Defeat the guardian',
      lootHint: 'a thornwood key',
    },
  ]);

  it('splits brief text from seeds block', () => {
    const raw = `PREMISE: A dark forest threatens the realm.\nENCOUNTER_SEEDS:\n${VALID_SEEDS}`;
    const { brief, seeds } = parseEncounterSeeds(raw);
    expect(brief).toBe('PREMISE: A dark forest threatens the realm.');
    expect(seeds).toHaveLength(1);
    expect(seeds![0].name).toBe('Thornwood Guardian');
    expect(seeds![0].lootHint).toBe('a thornwood key');
  });

  it('handles json fenced code block', () => {
    const raw = `PREMISE: Quest.\nENCOUNTER_SEEDS:\n\`\`\`json\n${VALID_SEEDS}\n\`\`\``;
    const { brief, seeds } = parseEncounterSeeds(raw);
    expect(brief).toBe('PREMISE: Quest.');
    expect(seeds).toHaveLength(1);
  });

  it('returns null seeds when marker is absent', () => {
    const { brief, seeds } = parseEncounterSeeds('PREMISE: A quest.');
    expect(brief).toBe('PREMISE: A quest.');
    expect(seeds).toBeNull();
  });

  it('returns null seeds when JSON is malformed', () => {
    const { brief, seeds } = parseEncounterSeeds('PREMISE: Quest.\nENCOUNTER_SEEDS:\nnot json at all');
    expect(brief).toBe('PREMISE: Quest.');
    expect(seeds).toBeNull();
  });

  it('returns null seeds when parsed value is not an array', () => {
    const { brief, seeds } = parseEncounterSeeds('PREMISE: Quest.\nENCOUNTER_SEEDS:\n{"name":"oops"}');
    expect(brief).toBe('PREMISE: Quest.');
    expect(seeds).toBeNull();
  });

  it('fallback A: handles response that is only a bare JSON array', () => {
    const { brief, seeds } = parseEncounterSeeds(VALID_SEEDS);
    expect(brief).toBe('');
    expect(seeds).toHaveLength(1);
    expect(seeds![0].name).toBe('Thornwood Guardian');
  });

  it('fallback A: handles response that is only a fenced JSON array', () => {
    const raw = `\`\`\`json\n${VALID_SEEDS}\n\`\`\``;
    const { brief, seeds } = parseEncounterSeeds(raw);
    expect(brief).toBe('');
    expect(seeds).toHaveLength(1);
  });

  it('fallback B: handles prose followed by fenced JSON with no ENCOUNTER_SEEDS marker', () => {
    const raw = `PREMISE: A dark quest.\nTONE: Adventurous.\n\`\`\`json\n${VALID_SEEDS}\n\`\`\``;
    const { brief, seeds } = parseEncounterSeeds(raw);
    expect(brief).toBe('PREMISE: A dark quest.\nTONE: Adventurous.');
    expect(seeds).toHaveLength(1);
    expect(seeds![0].name).toBe('Thornwood Guardian');
  });
});

describe('buildCampaignStateSummaryPrompt', () => {
  it('asks for campaign-state fields that keep the next turn moving', () => {
    const prompt = buildCampaignStateSummaryPrompt('Pip found the moon key.', [
      'Pip opened the cellar door.',
      'Zara spotted silver footprints.',
    ]);

    expect(prompt).toContain('Story so far: Pip found the moon key.');
    expect(prompt).toContain('1. Pip opened the cellar door.');
    expect(prompt).toContain('2. Zara spotted silver footprints.');
    expect(prompt).toContain('CURRENT ARC:');
    expect(prompt).toContain('OPEN THREAD:');
    expect(prompt).toContain('NEXT PROMISED BEAT:');
    expect(prompt).toContain('RECENTLY RESOLVED:');
  });
});
