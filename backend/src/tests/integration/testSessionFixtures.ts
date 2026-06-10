import fs from 'fs';
import os from 'os';
import path from 'path';
import { getDb } from '../../persistence/database.js';
import { StateService } from '../../services/stateService.js';
import type { Choice, SessionState } from '../../types.js';

export type IntegrationTestPaths = {
  dbPath: string;
  imageStoragePath: string;
};

export const setupIntegrationEnvironment = (name: string): IntegrationTestPaths => {
  const suffix = `${name}-${process.pid}-${Date.now()}`;
  const paths = {
    dbPath: path.join(os.tmpdir(), `dnd-${suffix}.sqlite`),
    imageStoragePath: path.join(os.tmpdir(), `dnd-${suffix}-images`),
  };

  process.env.SQLITE_DB_PATH = paths.dbPath;
  process.env.LOCAL_IMAGE_STORAGE_PATH = paths.imageStoragePath;
  process.env.LOCAL_IMAGE_PUBLIC_BASE_URL = '/test-images';
  process.env.IMAGE_STORAGE_PROVIDER = 'local';
  process.env.OPENAI_BASE_URL = 'http://127.0.0.1:1';
  process.env.OPENAI_API_KEY = 'test-invalid-key';
  StateService.initialize();

  return paths;
};

export const cleanupIntegrationEnvironment = (paths: IntegrationTestPaths): void => {
  try {
    fs.unlinkSync(paths.dbPath);
  } catch {
    // ignore
  }
  try {
    fs.rmSync(paths.imageStoragePath, { recursive: true, force: true });
  } catch {
    // ignore
  }
};

export const makeTestSession = (overrides: Partial<SessionState> = {}): SessionState => ({
  id: 'integration-session',
  scene: 'A goblin kitchen',
  sceneId: 'kitchen-1',
  worldDescription: 'A playful dungeon full of cooking smells',
  turn: 1,
  party: [
    {
      id: 'char-pip',
      name: 'Pip',
      class: 'Rogue',
      species: 'Halfling',
      quirk: 'Always hungry',
      hp: 8,
      max_hp: 10,
      status: 'active',
      stats: { might: 2, magic: 1, mischief: 4 },
      inventory: [],
    },
    {
      id: 'char-zara',
      name: 'Zara',
      class: 'Wizard',
      species: 'Elf',
      quirk: 'Talks to books',
      hp: 10,
      max_hp: 10,
      status: 'active',
      stats: { might: 1, magic: 5, mischief: 2 },
      inventory: [],
    },
  ],
  activeCharacterId: 'char-pip',
  npcs: [],
  quests: [],
  lastChoices: [],
  tone: 'thrilling adventure',
  recentHistory: ['Adventure begins!'],
  displayName: 'Integration Realm',
  difficulty: 'normal',
  gameMode: 'balanced',
  savingsMode: true,
  interventionState: { rescuesUsed: 0 },
  storySummary: '',
  gameOver: false,
  ...overrides,
});

export const insertSessionState = async (state: SessionState): Promise<void> => {
  getDb().prepare(
    'INSERT INTO sessions (id, scene, sceneId, worldDescription, dm_prep, dm_prep_image_brief, turn, activeCharacterId, tone, displayName, difficulty, gameMode, useLocalAI, savingsMode, namespace_id, storySummary) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    state.id,
    state.scene,
    state.sceneId,
    state.worldDescription ?? null,
    state.dmPrep ?? null,
    state.dmPrepImageBrief ?? null,
    state.turn,
    state.activeCharacterId,
    state.tone,
    state.displayName,
    state.difficulty,
    state.gameMode ?? 'balanced',
    0,
    state.savingsMode ? 1 : 0,
    'local',
    state.storySummary ?? '',
  );

  await StateService.updateSession(state.id, state);
};

export const choicesForSession = (): Choice[] => [
  { label: 'Press the attack', difficulty: 'normal', stat: 'might' },
  { label: 'Taunt the goblin', difficulty: 'easy', stat: 'mischief' },
  { label: 'Flee dramatically', difficulty: 'hard', stat: 'magic' },
];
