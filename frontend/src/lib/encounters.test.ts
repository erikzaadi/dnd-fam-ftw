import { describe, it, expect } from 'vitest';
import type { Session, EncounterState } from '../types';
import { patchEncounterEnemyAvatar, patchEncounterAreaImage } from './encounters';

const makeEnemy = (id: string) => ({
  id,
  name: `Enemy ${id}`,
  role: 'standard' as const,
  hp: 6,
  maxHp: 6,
  status: 'active' as const,
});

const makeArea = (id: string) => ({
  id,
  label: `Area ${id}`,
  description: '',
  tags: [],
});

const makeEncounter = (id: string, overrides: Partial<EncounterState> = {}): EncounterState => ({
  id,
  name: `Encounter ${id}`,
  status: 'active',
  round: 1,
  enemies: [makeEnemy('e1')],
  areas: [makeArea('a1')],
  ...overrides,
});

const makeSession = (overrides: Partial<Session> = {}): Session => ({
  id: 'session-1',
  scene: 'A dark dungeon',
  sceneId: 'dungeon-1',
  turn: 3,
  tone: 'thrilling',
  party: [],
  activeCharacterId: '',
  lastChoices: [],
  difficulty: 'normal',
  gameMode: 'balanced',
  savingsMode: false,
  imagesEnabled: true,
  gameOver: false,
  ...overrides,
} as Session);

describe('patchEncounterEnemyAvatar', () => {
  it('patches avatarUrl on an enemy in the active encounter', () => {
    const session = makeSession({ encounterState: makeEncounter('enc-1') });
    const result = patchEncounterEnemyAvatar(session, 'enc-1', 'e1', '/images/enemy.png');
    expect(result.encounterState?.enemies[0].avatarUrl).toBe('/images/enemy.png');
  });

  it('patches avatarUrl on an enemy in a past encounter', () => {
    const session = makeSession({
      pastEncounters: [makeEncounter('enc-past', { status: 'defeated' })],
    });
    const result = patchEncounterEnemyAvatar(session, 'enc-past', 'e1', '/images/past.png');
    expect(result.pastEncounters?.[0].enemies[0].avatarUrl).toBe('/images/past.png');
  });

  it('does not modify other enemies', () => {
    const enc = makeEncounter('enc-1', {
      enemies: [makeEnemy('e1'), makeEnemy('e2')],
    });
    const session = makeSession({ encounterState: enc });
    const result = patchEncounterEnemyAvatar(session, 'enc-1', 'e1', '/images/e1.png');
    expect(result.encounterState?.enemies[1].avatarUrl).toBeUndefined();
  });

  it('returns session unchanged when encounter id does not match', () => {
    const session = makeSession({ encounterState: makeEncounter('enc-1') });
    const result = patchEncounterEnemyAvatar(session, 'enc-other', 'e1', '/images/x.png');
    expect(result.encounterState?.enemies[0].avatarUrl).toBeUndefined();
  });
});

describe('patchEncounterAreaImage', () => {
  it('patches imageUrl on an area in the active encounter', () => {
    const session = makeSession({ encounterState: makeEncounter('enc-1') });
    const result = patchEncounterAreaImage(session, 'enc-1', 'a1', '/images/area.png');
    expect(result.encounterState?.areas[0].imageUrl).toBe('/images/area.png');
  });

  it('patches imageUrl on an area in a past encounter', () => {
    const session = makeSession({
      pastEncounters: [makeEncounter('enc-past', { status: 'defeated' })],
    });
    const result = patchEncounterAreaImage(session, 'enc-past', 'a1', '/images/past-area.png');
    expect(result.pastEncounters?.[0].areas[0].imageUrl).toBe('/images/past-area.png');
  });

  it('does not modify other areas', () => {
    const enc = makeEncounter('enc-1', {
      areas: [makeArea('a1'), makeArea('a2')],
    });
    const session = makeSession({ encounterState: enc });
    const result = patchEncounterAreaImage(session, 'enc-1', 'a1', '/images/a1.png');
    expect(result.encounterState?.areas[1].imageUrl).toBeUndefined();
  });
});
