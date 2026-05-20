import { describe, it, expect, vi, beforeEach, type MockInstance } from 'vitest';
import {
  buildCampaignStateSummaryPrompt,
  parseEncounterSeeds,
  StorySummaryService,
  villainMentionedInAction,
} from './storySummaryService.js';
import { StateService } from './stateService.js';
import type { SessionState, TurnResult } from '../types.js';

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
      enemies: [{ name: 'Vine Beast', role: 'standard', weaknesses: [{ label: 'dry thornwood sap', school: 'fire' }] }],
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
    expect(seeds![0].enemies[0].weaknesses?.[0]).toEqual({ label: 'dry thornwood sap', school: 'fire' });
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

describe('villainMentionedInAction', () => {
  it('correctly matches villain name tokens', () => {
    const name = 'Soris the Eternal Scribe';
    expect(villainMentionedInAction(name, 'I strike Soris')).toBe(true);
    expect(villainMentionedInAction(name, 'I attack the scribe')).toBe(true);
    expect(villainMentionedInAction(name, 'I use the magic circle')).toBe(false);
  });

  it('filters out common titles and short tokens', () => {
    const name = 'Lord Bob';
    // 'lord' is a stop-word, 'bob' is <= 3 chars.
    // Significant tokens: []. So it shouldn't match anything.
    expect(villainMentionedInAction(name, 'I hit the Lord')).toBe(false);
    expect(villainMentionedInAction(name, 'I attack Bob')).toBe(false);
  });
});

describe('buildCampaignStateSummaryPrompt with Location Stall and Frozen Villains', () => {
  it('appends location stall instructions if currentScene is provided', () => {
    const prompt = buildCampaignStateSummaryPrompt(
      'Story so far.',
      ['Action A'],
      [],
      [],
      'The Whispering Woods'
    );
    expect(prompt).toContain('The party\'s current location is: "The Whispering Woods".');
    expect(prompt).toContain('LOCATION STALL: party remains in The Whispering Woods');
    expect(prompt).not.toContain('FROZEN CONFRONTATION:');
  });

  it('appends frozen villain instructions if frozenVillains is non-empty', () => {
    const prompt = buildCampaignStateSummaryPrompt(
      'Story so far.',
      ['Action A'],
      ['Malakor the Defiler'],
      ['I search for Malakor', 'I call out to Malakor'],
      undefined
    );
    expect(prompt).not.toContain('LOCATION STALL:');
    expect(prompt).toContain('The following villain(s) have been targeted in multiple player actions');
    expect(prompt).toContain('Malakor the Defiler');
    expect(prompt).toContain('FROZEN CONFRONTATION: <villain name>');
    expect(prompt).toContain('Recent player actions: I search for Malakor | I call out to Malakor');
  });
});

describe('StorySummaryService.maybeUpdate candidate derivation', () => {
  let getSessionSpy: MockInstance;
  let getTurnHistorySpy: MockInstance;
  let updateSummarySpy: MockInstance;
  let callSummarizeSpy: MockInstance;

  beforeEach(() => {
    vi.restoreAllMocks();
    getSessionSpy = vi.spyOn(StateService, 'getSession');
    getTurnHistorySpy = vi.spyOn(StateService, 'getTurnHistory');
    updateSummarySpy = vi.spyOn(StateService, 'updateStorySummary').mockResolvedValue(undefined);
    callSummarizeSpy = vi.spyOn(
      StorySummaryService as unknown as {
        callSummarize: (prompt: string, maxTokens?: number, timeoutMs?: number, label?: string) => Promise<string>;
      },
      'callSummarize'
    ).mockResolvedValue('NEW_SUMMARY');
  });

  it('correctly derives frozen villains and calls summarize', async () => {
    const session = {
      id: 'sess-123',
      scene: 'The Frozen Caves',
      storySummary: 'Prev summary.',
      encounterState: { status: 'none' }, // inactive
      pastEncounters: [
        { enemies: [{ name: 'Dead Skeleton' }] }
      ],
      dmPrepEncounters: [
        {
          name: 'Malakor Encounter',
          enemies: [
            { name: 'Malakor the Defiler', role: 'boss' }, // role is boss, len > 6
            { name: 'Mini Imp', role: 'standard' }, // standard role, ignored
            { name: 'Tiny', role: 'elite' }, // elite, but name length <= 6, ignored
            { name: 'Dead Skeleton', role: 'boss' }, // already resolved, ignored
          ]
        }
      ]
    } as unknown as SessionState;

    const history = [
      { narration: 'Turn 1', lastAction: { actionAttempt: 'We look for Malakor.' } },
      { narration: 'Turn 2', lastAction: { actionAttempt: 'We search the room.' } },
      { narration: 'Turn 3', lastAction: { actionAttempt: 'I slash at Malakor.' } },
      { narration: 'Turn 4', lastAction: { actionAttempt: 'We take a rest.' } },
      { narration: 'Turn 5', lastAction: { actionAttempt: 'We run away.' } },
    ] as unknown as TurnResult[];

    getSessionSpy.mockResolvedValue(session);
    getTurnHistorySpy.mockResolvedValue(history);

    await StorySummaryService.maybeUpdate('sess-123', 5);

    expect(callSummarizeSpy).toHaveBeenCalled();
    const promptPassed = callSummarizeSpy.mock.calls[0][0];

    // Malakor the Defiler has been mentioned twice (Turn 1, Turn 3)
    expect(promptPassed).toContain('Malakor the Defiler');
    // Mini Imp is ignored
    expect(promptPassed).not.toContain('Mini Imp');
    // Tiny is ignored (name <= 6 chars)
    expect(promptPassed).not.toContain('Tiny');
    // Dead Skeleton is ignored (resolved)
    expect(promptPassed).not.toContain('Dead Skeleton');

    expect(promptPassed).toContain('The party\'s current location is: "The Frozen Caves"');
    expect(updateSummarySpy).toHaveBeenCalledWith('sess-123', 'NEW_SUMMARY');
  });

  it('returns empty frozen villains if encounter is active', async () => {
    const session = {
      id: 'sess-123',
      scene: 'The Frozen Caves',
      storySummary: 'Prev summary.',
      encounterState: { status: 'active' }, // active!
      dmPrepEncounters: [
        {
          name: 'Malakor Encounter',
          enemies: [
            { name: 'Malakor the Defiler', role: 'boss' }
          ]
        }
      ]
    } as unknown as SessionState;

    const history = [
      { narration: 'Turn 1', lastAction: { actionAttempt: 'We look for Malakor.' } },
      { narration: 'Turn 2', lastAction: { actionAttempt: 'We search the room.' } },
      { narration: 'Turn 3', lastAction: { actionAttempt: 'I slash at Malakor.' } },
      { narration: 'Turn 4', lastAction: { actionAttempt: 'We take a rest.' } },
      { narration: 'Turn 5', lastAction: { actionAttempt: 'We run away.' } },
    ] as unknown as TurnResult[];

    getSessionSpy.mockResolvedValue(session);
    getTurnHistorySpy.mockResolvedValue(history);

    await StorySummaryService.maybeUpdate('sess-123', 5);

    expect(callSummarizeSpy).toHaveBeenCalled();
    const promptPassed = callSummarizeSpy.mock.calls[0][0];

    // Malakor is frozen, but active combat disables frozen villain detection
    expect(promptPassed).not.toContain('Malakor the Defiler');
  });
});
