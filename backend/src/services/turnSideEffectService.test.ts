import { beforeEach, describe, expect, it, vi } from 'vitest';
import { queueCompletedTurnSideEffects } from './turnSideEffectService.js';
import type { SessionState, TurnResult } from '../types.js';

vi.mock('../realtime/sessionEvents.js', () => ({
  broadcastUpdate: vi.fn(),
  broadcastSessionChanged: vi.fn(),
}));

vi.mock('./storySummaryService.js', () => ({
  StorySummaryService: { maybeUpdate: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('./stateService.js', () => ({
  StateService: {
    updateLatestTurnImage: vi.fn().mockResolvedValue(undefined),
    patchEncounterEnemyAvatar: vi.fn().mockResolvedValue(undefined),
    patchEncounterAreaImage: vi.fn().mockResolvedValue(undefined),
  },
}));

const imageServiceMocks = vi.hoisted(() => ({
  generateImage: vi.fn(),
  generateEnemyAvatar: vi.fn(),
  generateAreaImage: vi.fn(),
}));

vi.mock('./imageService.js', () => ({
  ImageService: imageServiceMocks,
}));

const makeSession = (overrides: Partial<SessionState> = {}): SessionState => ({
  id: 'test-session',
  scene: 'A dark forest',
  sceneId: 'forest-1',
  worldDescription: 'Spooky woods',
  turn: 5,
  party: [],
  activeCharacterId: 'char-1',
  npcs: [],
  quests: [],
  lastChoices: [],
  tone: 'eerie',
  recentHistory: [],
  displayName: 'Test Realm',
  difficulty: 'normal',
  gameMode: 'balanced',
  savingsMode: false,
  interventionState: { rescuesUsed: 0 },
  storySummary: '',
  gameOver: false,
  ...overrides,
});

const makeTurnResult = (overrides: Partial<TurnResult> = {}): TurnResult => ({
  narration: 'Something happened.',
  choices: [],
  imageSuggested: true,
  imagePrompt: 'a dark forest scene',
  currentTensionLevel: 'medium',
  suggestedInventoryAdd: null,
  suggestedInventoryRemove: null,
  suggestedInventoryUpdate: null,
  suggestedRevive: null,
  suggestedHeal: null,
  suggestedBuffAdd: null,
  suggestedBuffRemove: null,
  suggestedDamage: null,
  suggestedEncounterStart: null,
  suggestedEncounterUpdate: null,
  ...overrides,
});

const flushPromises = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

describe('turnSideEffectService deduplication', () => {
  beforeEach(() => {
    imageServiceMocks.generateImage.mockReset();
    imageServiceMocks.generateEnemyAvatar.mockReset();
    imageServiceMocks.generateAreaImage.mockReset();
  });

  it('skips a duplicate in-flight scene image job for the same session and turn', async () => {
    let resolveFirst!: () => void;
    imageServiceMocks.generateImage.mockReturnValueOnce(
      new Promise<null>(resolve => {
        resolveFirst = () => resolve(null);
      }),
    );

    const session = makeSession();
    const turnResult = makeTurnResult();

    queueCompletedTurnSideEffects({ sessionId: session.id, namespaceId: 'local', previousSession: session, newState: session, turnResult });
    queueCompletedTurnSideEffects({ sessionId: session.id, namespaceId: 'local', previousSession: session, newState: session, turnResult });

    resolveFirst();
    await vi.waitFor(() => expect(imageServiceMocks.generateImage).toHaveBeenCalledTimes(1));
    await flushPromises();
  });

  it('allows a new scene image job after the previous one settles', async () => {
    imageServiceMocks.generateImage.mockResolvedValue(null);

    const session = makeSession();
    const turnResult = makeTurnResult();

    queueCompletedTurnSideEffects({ sessionId: session.id, namespaceId: 'local', previousSession: session, newState: session, turnResult });
    await vi.waitFor(() => expect(imageServiceMocks.generateImage).toHaveBeenCalledTimes(1));
    await flushPromises();

    queueCompletedTurnSideEffects({ sessionId: session.id, namespaceId: 'local', previousSession: session, newState: session, turnResult });
    await vi.waitFor(() => expect(imageServiceMocks.generateImage).toHaveBeenCalledTimes(2));
  });

  it('skips duplicate in-flight encounter enemy avatar jobs', async () => {
    let resolveFirst!: () => void;
    imageServiceMocks.generateEnemyAvatar.mockReturnValueOnce(
      new Promise<{ url: string }>(resolve => {
        resolveFirst = () => resolve({ url: '' });
      }),
    );

    const encounter = {
      id: 'enc-1',
      name: 'Goblin Ambush',
      status: 'active' as const,
      round: 1,
      enemies: [{ id: 'enemy-1', name: 'Goblin', role: 'minion' as const, hp: 3, maxHp: 3, status: 'active' as const }],
      areas: [],
    };
    const previousSession = makeSession({ encounterState: undefined });
    const newState = makeSession({ encounterState: encounter });
    const turnResult = makeTurnResult({ imageSuggested: false });

    queueCompletedTurnSideEffects({ sessionId: newState.id, namespaceId: 'local', previousSession, newState, turnResult });
    queueCompletedTurnSideEffects({ sessionId: newState.id, namespaceId: 'local', previousSession, newState, turnResult });

    resolveFirst();
    await vi.waitFor(() => expect(imageServiceMocks.generateEnemyAvatar).toHaveBeenCalledTimes(1));
    await flushPromises();
  });
});
