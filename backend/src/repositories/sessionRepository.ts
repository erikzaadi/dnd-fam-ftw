import { createId } from '../lib/ids.js';
import { getDb } from '../persistence/database.js';
import { areIdeasCurrent } from './turnHistoryRepository.js';
import { generateSessionDisplayName } from '../services/sessionNameService.js';
import { SessionState, InventoryItem, type AdventureFormat, type AdventureProgress, type AdventureStatus, type Character, type Choice, type GameMode, type EncounterState, type EncounterSeed } from '../types.js';
import { buildAdventureProgress, createInitialArc, parseArc, serializeArc } from '../services/adventureLifecycleService.js';

export type SessionListItem = {
  id: string;
  displayName: string;
  worldDescription?: string;
  storySummary?: string;
  dmPrep?: string;
  difficulty: string;
  gameMode: string;
  gameOver?: boolean;
  adventureFormat?: AdventureFormat;
  adventureStatus?: AdventureStatus;
  previewImageUrl?: string;
  party: {
    id: string;
    name: string;
    class: string;
    species: string;
    avatarUrl?: string;
    hp: number;
    max_hp: number;
  }[];
};

export type SessionPatch = {
  difficulty?: string;
  gameMode?: string;
  dmPrep?: string | null;
  compiledDmPrep?: string | null;
  dmPrepImageBrief?: string | null;
  worldDescription?: string | null;
  encounterState?: EncounterState | null;
  pastEncounters?: EncounterState[] | null;
  dmPrepEncounters?: EncounterSeed[] | null;
  originStory?: string | null;
  originStoryImageUrl?: string | null;
  originStoryImageStorageKey?: string | null;
  originStoryImageStorageProvider?: string | null;
  originStoryGeneratedAt?: string | null;
  autoIdeas?: boolean;
};

const writeInventorySync = (char: Character): void => {
  const db = getDb();
  db.prepare('DELETE FROM inventory WHERE characterId = ?').run(char.id);
  for (const item of (char.inventory ?? [])) {
    db.prepare('INSERT INTO inventory (characterId, itemId, name, description, statBonuses, healValue, transferable, consumable, tags, effect, charges, condition, boundToCharacterId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(
        char.id,
        item.id,
        item.name,
        item.description,
        item.statBonuses ? JSON.stringify(item.statBonuses) : null,
        item.healValue ?? null,
        item.transferable != null ? (item.transferable ? 1 : 0) : null,
        item.consumable != null ? (item.consumable ? 1 : 0) : null,
        item.tags && item.tags.length > 0 ? JSON.stringify(item.tags) : null,
        item.effect ?? null,
        item.charges ?? null,
        item.condition ?? null,
        item.boundToCharacterId ?? null,
      );
  }
};

// Keeps enemy avatars and area images that background jobs stored after the
// gameplay snapshot was read.
export const mergeEncounterMedia = (next: EncounterState, current: EncounterState[]): EncounterState => {
  const stored = current.find(enc => enc.id === next.id);
  if (!stored) {
    return next;
  }
  return {
    ...next,
    enemies: next.enemies.map(enemy => {
      const storedEnemy = stored.enemies.find(e => e.id === enemy.id);
      return !enemy.avatarUrl && storedEnemy?.avatarUrl ? { ...enemy, avatarUrl: storedEnemy.avatarUrl } : enemy;
    }),
    areas: next.areas.map(area => {
      const storedArea = stored.areas.find(a => a.id === area.id);
      return !area.imageUrl && storedArea?.imageUrl ? { ...area, imageUrl: storedArea.imageUrl } : area;
    }),
  };
};

export const sessionRepository = {
  async createSession(
    worldDescription?: string,
    difficulty: string = 'normal',
    savingsMode: boolean = false,
    namespaceId: string = 'local',
    gameMode: GameMode = 'balanced',
    dmPrep?: string,
    initialDisplayName?: string,
    initialId?: string,
    // New sessions default to one evening; the column default (long_lived) only applies
    // to sessions that existed before the lifecycle was introduced.
    adventureFormat: AdventureFormat = 'one_evening',
  ): Promise<SessionState> {
    const db = getDb();
    const id = initialId ?? createId();
    const displayName = initialDisplayName ?? await generateSessionDisplayName(worldDescription);
    const arc = createInitialArc();

    db.prepare('INSERT INTO sessions (id, scene, sceneId, worldDescription, dm_prep, dm_prep_image_brief, turn, tone, displayName, difficulty, gameMode, useLocalAI, savingsMode, namespace_id, adventure_format, adventure_status, adventure_arc) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, "A New Realm", "start-1", worldDescription || null, dmPrep || null, null, 1, "thrilling adventure", displayName, difficulty, gameMode, 0, savingsMode ? 1 : 0, namespaceId, adventureFormat, 'active', serializeArc(arc));

    return {
      id,
      scene: "A New Realm",
      sceneId: "start-1",
      worldDescription,
      dmPrep,
      dmPrepImageBrief: undefined,
      turn: 1,
      party: [],
      activeCharacterId: "",
      npcs: [],
      quests: [],
      lastChoices: [],
      tone: "thrilling adventure",
      gameMode,
      recentHistory: ["Adventure begins!"],
      displayName,
      difficulty,
      savingsMode,
      interventionState: { rescuesUsed: 0 },
      storySummary: '',
      gameOver: false,
      revision: 0,
      adventure: buildAdventureProgress({ format: adventureFormat, status: 'active', arc, partySize: 0 }),
    };
  },

  async getSession(id: string): Promise<SessionState | undefined> {
    const db = getDb();
    const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as {
      id: string;
      scene: string;
      sceneId: string;
      worldDescription: string | null;
      dm_prep: string | null;
      compiled_dm_prep: string | null;
      dm_prep_image_brief: string | null;
      encounter_state: string | null;
      past_encounters: string | null;
      dm_prep_encounters: string | null;
      turn: number;
      activeCharacterId: string;
      tone: string;
      displayName: string;
      difficulty: string;
      gameMode: string;
      savingsMode: number;
      interventionUsed: number;
      rescues_used: number;
      game_over: number;
      storySummary: string;
      preview_image_url: string | null;
      origin_story: string | null;
      origin_story_image_url: string | null;
      origin_story_image_storage_key: string | null;
      origin_story_image_storage_provider: string | null;
      origin_story_generated_at: string | null;
      revision: number | null;
      adventure_format: string | null;
      adventure_status: string | null;
      adventure_arc: string | null;
      adventure_objective: string | null;
      adventure_plan: string | null;
      onboarding_ideas: string | null;
      auto_ideas: number | null;
    } | undefined;
    if (!row) {
      return undefined;
    }

    const characters = db.prepare('SELECT * FROM characters WHERE sessionId = ?').all(id) as {
      id: string;
      name: string;
      class: string;
      species: string;
      quirk: string;
      hp: number;
      max_hp: number;
      might: number;
      magic: number;
      mischief: number;
      avatarUrl: string | null;
      avatarPrompt: string | null;
      avatar_storage_key: string | null;
      avatar_storage_provider: string | null;
      status: string | null;
      history: string | null;
      gender: string | null;
      buffs: string | null;
    }[];
    for (const char of characters) {
      const rawInv = db.prepare('SELECT * FROM inventory WHERE characterId = ?').all(char.id) as {
        id: number;
        itemId: string | null;
        name: string;
        description: string;
        statBonuses: string | null;
        healValue: number | null;
        transferable: number | null;
        consumable: number | null;
        tags: string | null;
        effect: string | null;
        charges: number | null;
        condition: string | null;
        boundToCharacterId: string | null;
      }[];
      (char as unknown as { inventory: InventoryItem[] }).inventory = rawInv.map(i => ({
        id: i.itemId ?? String(i.id),
        name: i.name,
        description: i.description,
        statBonuses: i.statBonuses ? JSON.parse(i.statBonuses) : undefined,
        healValue: i.healValue ?? undefined,
        transferable: i.transferable != null ? !!i.transferable : undefined,
        consumable: i.consumable != null ? !!i.consumable : undefined,
        tags: i.tags ? JSON.parse(i.tags) : undefined,
        effect: i.effect || undefined,
        charges: i.charges ?? undefined,
        condition: i.condition || undefined,
        boundToCharacterId: i.boundToCharacterId || undefined,
      }));
      (char as unknown as { stats: { might: number, magic: number, mischief: number } }).stats = { might: char.might, magic: char.magic, mischief: char.mischief };
    }

    return {
      id: row.id,
      scene: row.scene,
      sceneId: row.sceneId,
      worldDescription: row.worldDescription || undefined,
      dmPrep: row.dm_prep || undefined,
      compiledDmPrep: row.compiled_dm_prep || undefined,
      dmPrepImageBrief: row.dm_prep_image_brief || undefined,
      encounterState: row.encounter_state ? (JSON.parse(row.encounter_state) as EncounterState) : undefined,
      pastEncounters: row.past_encounters ? (JSON.parse(row.past_encounters) as EncounterState[]) : undefined,
      dmPrepEncounters: row.dm_prep_encounters ? (JSON.parse(row.dm_prep_encounters) as EncounterSeed[]) : undefined,
      turn: row.turn,
      party: characters.map(c => ({
        id: c.id,
        name: c.name,
        class: c.class,
        species: c.species,
        quirk: c.quirk,
        hp: c.hp,
        max_hp: c.max_hp,
        status: c.hp === 0 ? 'downed' : ((c.status as 'active' | 'downed') ?? 'active'),
        avatarUrl: c.avatarUrl || undefined,
        avatarPrompt: c.avatarPrompt || undefined,
        avatarStorageKey: c.avatar_storage_key || undefined,
        avatarStorageProvider: c.avatar_storage_provider || undefined,
        history: c.history || undefined,
        gender: c.gender || undefined,
        stats: (c as unknown as { stats: { might: number, magic: number, mischief: number } }).stats,
        inventory: (c as unknown as { inventory: InventoryItem[] }).inventory,
        buffs: c.buffs ? JSON.parse(c.buffs) : [],
      })),
      activeCharacterId: row.activeCharacterId || "",
      npcs: [],
      quests: [],
      // Only current ideas: a revision bump (settings, party edits) or a different acting
      // hero makes the latest turn's choices stale, so they can no longer be shown or picked.
      lastChoices: (() => {
        const lastTurn = db.prepare('SELECT id, ideas_revision, ideas_character_id FROM turn_history WHERE sessionId = ? ORDER BY id DESC LIMIT 1')
          .get(id) as { id: number; ideas_revision: number | null; ideas_character_id: string | null } | undefined;
        if (!lastTurn || !areIdeasCurrent({ ideasRevision: lastTurn.ideas_revision, ideasCharacterId: lastTurn.ideas_character_id }, { revision: row.revision ?? 0, activeCharacterId: row.activeCharacterId || '' })) {
          return [];
        }
        const choiceRows = db.prepare(
          'SELECT id, label, difficulty, stat, difficultyValue, narration, riddleAnswer, riddleCorrect, flavor, helperCharacterName, itemOwnerName, itemName, environmentFeature FROM turn_choices WHERE turnId = ? ORDER BY rowid'
        ).all(lastTurn.id) as {
          id: number; label: string; difficulty: string; stat: string;
          difficultyValue: number | null; narration: string | null;
          riddleAnswer: string | null; riddleCorrect: number | null;
          flavor: string | null; helperCharacterName: string | null;
          itemOwnerName: string | null; itemName: string | null; environmentFeature: string | null;
        }[];
        return choiceRows.map(c => ({
          id: c.id,
          label: c.label,
          difficulty: c.difficulty as Choice['difficulty'],
          stat: c.stat as Choice['stat'],
          ...(c.difficultyValue !== null && { difficultyValue: c.difficultyValue }),
          ...(c.narration !== null && { narration: c.narration }),
          ...(c.riddleAnswer !== null && { riddleAnswer: c.riddleAnswer }),
          ...(c.riddleCorrect !== null && { riddleCorrect: !!c.riddleCorrect }),
          ...(c.flavor !== null && { flavor: c.flavor as Choice['flavor'] }),
          ...(c.helperCharacterName !== null && { helperCharacterName: c.helperCharacterName }),
          ...(c.itemOwnerName !== null && { itemOwnerName: c.itemOwnerName }),
          ...(c.itemName !== null && { itemName: c.itemName }),
          ...(c.environmentFeature !== null && { environmentFeature: c.environmentFeature }),
        }));
      })(),
      tone: row.tone,
      recentHistory: (() => {
        const rows = db.prepare('SELECT narration FROM turn_history WHERE sessionId = ? ORDER BY id DESC LIMIT 3').all(id) as { narration: string }[];
        return rows.length > 0 ? rows.reverse().map(r => r.narration) : ['Adventure begins!'];
      })(),
      displayName: row.displayName,
      difficulty: row.difficulty,
      gameMode: (row.gameMode as GameMode) || 'balanced',
      savingsMode: !!row.savingsMode,
      interventionState: { rescuesUsed: row.rescues_used ?? (row.interventionUsed ? 1 : 0) },
      storySummary: row.storySummary ?? '',
      gameOver: !!row.game_over,
      previewImageUrl: row.preview_image_url || undefined,
      originStory: row.origin_story || undefined,
      originStoryImageUrl: row.origin_story_image_url || undefined,
      revision: row.revision ?? 0,
      ...(row.onboarding_ideas === 'pending' && { onboardingIdeasPending: true }),
      ...(row.auto_ideas ? { autoIdeas: true } : {}),
      adventure: buildAdventureProgress({
        format: (row.adventure_format as AdventureFormat | null) ?? 'long_lived',
        status: (row.adventure_status as AdventureStatus | null) ?? 'active',
        arc: parseArc(row.adventure_arc),
        objective: row.adventure_objective,
        partySize: characters.length,
      }),
      ...(row.adventure_plan && { adventurePlan: row.adventure_plan }),
    };
  },

  // Format, status and progress for settings/lifecycle mutations outside a turn.
  writeAdventureSync(id: string, progress: AdventureProgress): void {
    getDb().prepare('UPDATE sessions SET adventure_format = ?, adventure_status = ?, adventure_arc = ? WHERE id = ?')
      .run(progress.format, progress.status, serializeArc(progress), id);
  },

  // Stores the chapter objective once. Returns false if one was already set.
  setAdventureObjectiveIfMissing(id: string, objective: string, plan: string | null): boolean {
    const result = getDb().prepare('UPDATE sessions SET adventure_objective = ?, adventure_plan = COALESCE(?, adventure_plan) WHERE id = ? AND (adventure_objective IS NULL OR adventure_objective = \'\')')
      .run(objective, plan, id);
    return result.changes > 0;
  },

  // First writer wins: an origin story is written once and never replaced, so every
  // viewer reads the same one. Returns false when another request stored one first.
  setOriginStoryIfMissing(id: string, originStory: string, generatedAt: string): boolean {
    const result = getDb().prepare("UPDATE sessions SET origin_story = ?, origin_story_generated_at = ? WHERE id = ? AND (origin_story IS NULL OR origin_story = '')")
      .run(originStory, generatedAt, id);
    return result.changes > 0;
  },

  // Private future intent only; never touches the public objective or progress.
  setAdventurePlan(id: string, plan: string | null): void {
    getDb().prepare('UPDATE sessions SET adventure_plan = ? WHERE id = ?').run(plan, id);
  },

  // New chapter: clears the previous chapter's objective and private plan.
  clearAdventureObjectiveSync(id: string): void {
    getDb().prepare('UPDATE sessions SET adventure_objective = NULL, adventure_plan = NULL WHERE id = ?').run(id);
  },

  getRevision(id: string): number | undefined {
    const row = getDb().prepare('SELECT revision FROM sessions WHERE id = ?').get(id) as { revision: number } | undefined;
    return row?.revision;
  },

  // Increments the session revision. Use for settings/character mutations outside commitTurn.
  bumpRevision(id: string): number {
    const db = getDb();
    db.prepare('UPDATE sessions SET revision = revision + 1 WHERE id = ?').run(id);
    return (db.prepare('SELECT revision FROM sessions WHERE id = ?').get(id) as { revision: number } | undefined)?.revision ?? 0;
  },

  // Gameplay-owned columns only. Media (avatars, encounter art), settings and the story
  // summary have their own writers, so a turn computed from an older snapshot cannot
  // overwrite media or summaries that finished while the turn was generating.
  writeGameplayStateSync(id: string, state: SessionState): void {
    const db = getDb();
    const rescuesUsed = state.interventionState?.rescuesUsed ?? 0;
    const current = db.prepare('SELECT encounter_state, past_encounters FROM sessions WHERE id = ?').get(id) as { encounter_state: string | null; past_encounters: string | null } | undefined;
    const currentEncounters = [
      ...(current?.encounter_state ? [JSON.parse(current.encounter_state) as EncounterState] : []),
      ...(current?.past_encounters ? JSON.parse(current.past_encounters) as EncounterState[] : []),
    ];
    const encounterState = state.encounterState ? mergeEncounterMedia(state.encounterState, currentEncounters) : null;
    const pastEncounters = (state.pastEncounters ?? []).map(enc => mergeEncounterMedia(enc, currentEncounters));
    db.prepare('UPDATE sessions SET scene = ?, sceneId = ?, turn = ?, activeCharacterId = ?, tone = ?, interventionUsed = ?, rescues_used = ?, game_over = ?, encounter_state = ?, past_encounters = ? WHERE id = ?')
      .run(state.scene, state.sceneId, state.turn, state.activeCharacterId, state.tone, rescuesUsed > 0 ? 1 : 0, rescuesUsed, state.gameOver ? 1 : 0,
        encounterState ? JSON.stringify(encounterState) : null,
        pastEncounters.length > 0 ? JSON.stringify(pastEncounters) : null,
        id);
    // Chapter progress changes atomically with the turn. Format is a setting and is
    // not written from a gameplay snapshot.
    if (state.adventure) {
      db.prepare('UPDATE sessions SET adventure_status = ?, adventure_arc = ? WHERE id = ?')
        .run(state.adventure.status, serializeArc(state.adventure), id);
    }

    for (const char of state.party) {
      db.prepare(`INSERT INTO characters (id, sessionId, name, class, species, quirk, hp, max_hp, might, magic, mischief, avatarUrl, avatarPrompt, status, avatar_storage_key, avatar_storage_provider, history, gender, buffs)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET name = excluded.name, class = excluded.class, species = excluded.species, quirk = excluded.quirk,
          hp = excluded.hp, max_hp = excluded.max_hp, might = excluded.might, magic = excluded.magic, mischief = excluded.mischief,
          status = excluded.status, history = excluded.history, gender = excluded.gender, buffs = excluded.buffs`)
        .run(char.id, id, char.name, char.class, char.species, char.quirk, char.hp, char.max_hp, char.stats.might, char.stats.magic, char.stats.mischief, char.avatarUrl || null, char.avatarPrompt || null, char.status ?? 'active', char.avatarStorageKey || null, char.avatarStorageProvider || null, char.history || null, char.gender || null, char.buffs && char.buffs.length > 0 ? JSON.stringify(char.buffs) : null);
      writeInventorySync(char);
    }
  },

  getSessionNamespaceId(id: string): string | undefined {
    const db = getDb();
    const row = db.prepare('SELECT namespace_id FROM sessions WHERE id = ?').get(id) as { namespace_id: string } | undefined;
    return row?.namespace_id;
  },

  async setSavingsMode(id: string, enabled: boolean): Promise<void> {
    const db = getDb();
    db.prepare('UPDATE sessions SET savingsMode = ? WHERE id = ?').run(enabled ? 1 : 0, id);
  },

  async updateSession(id: string, state: SessionState): Promise<void> {
    sessionRepository.updateSessionSync(id, state);
  },

  // Full write including media and settings. Only for session setup paths (creation,
  // character assembly); gameplay uses commitTurn/writeGameplayStateSync.
  updateSessionSync(id: string, state: SessionState): void {
    const db = getDb();
    const rescuesUsed = state.interventionState?.rescuesUsed ?? 0;
    const encounterStateJson = state.encounterState != null ? JSON.stringify(state.encounterState) : null;
    const pastEncountersJson = state.pastEncounters && state.pastEncounters.length > 0 ? JSON.stringify(state.pastEncounters) : null;
    db.prepare('UPDATE sessions SET scene = ?, sceneId = ?, turn = ?, activeCharacterId = ?, tone = ?, interventionUsed = ?, rescues_used = ?, game_over = ?, storySummary = ?, difficulty = ?, gameMode = ?, encounter_state = ?, past_encounters = ? WHERE id = ?')
      .run(state.scene, state.sceneId, state.turn, state.activeCharacterId, state.tone, rescuesUsed > 0 ? 1 : 0, rescuesUsed, state.gameOver ? 1 : 0, state.storySummary ?? '', state.difficulty, state.gameMode ?? 'balanced', encounterStateJson, pastEncountersJson, id);

    for (const char of state.party) {
      db.prepare('INSERT OR REPLACE INTO characters (id, sessionId, name, class, species, quirk, hp, max_hp, might, magic, mischief, avatarUrl, avatarPrompt, status, avatar_storage_key, avatar_storage_provider, history, gender, buffs) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(char.id, id, char.name, char.class, char.species, char.quirk, char.hp, char.max_hp, char.stats.might, char.stats.magic, char.stats.mischief, char.avatarUrl || null, char.avatarPrompt || null, char.status ?? 'active', char.avatarStorageKey || null, char.avatarStorageProvider || null, char.history || null, char.gender || null, char.buffs && char.buffs.length > 0 ? JSON.stringify(char.buffs) : null);

      writeInventorySync(char);
    }
  },

  updateSessionPreviewImage(id: string, url: string): void {
    const db = getDb();
    db.prepare('UPDATE sessions SET preview_image_url = ? WHERE id = ?').run(url, id);
  },

  async patchSession(id: string, fields: SessionPatch): Promise<void> {
    sessionRepository.patchSessionSync(id, fields);
  },

  patchSessionSync(id: string, fields: SessionPatch): void {
    const db = getDb();
    const colMap: Record<string, string> = {
      difficulty: 'difficulty',
      gameMode: 'gameMode',
      dmPrep: 'dm_prep',
      compiledDmPrep: 'compiled_dm_prep',
      dmPrepImageBrief: 'dm_prep_image_brief',
      worldDescription: 'worldDescription',
      originStory: 'origin_story',
      originStoryImageUrl: 'origin_story_image_url',
      originStoryImageStorageKey: 'origin_story_image_storage_key',
      originStoryImageStorageProvider: 'origin_story_image_storage_provider',
      originStoryGeneratedAt: 'origin_story_generated_at',
    };
    const sets: string[] = [];
    const values: unknown[] = [];
    for (const [key, col] of Object.entries(colMap)) {
      if (key in fields) {
        sets.push(`${col} = ?`);
        values.push((fields as Record<string, unknown>)[key] ?? null);
      }
    }
    if ('autoIdeas' in fields) {
      sets.push('auto_ideas = ?');
      values.push(fields.autoIdeas ? 1 : 0);
    }
    if ('encounterState' in fields) {
      sets.push('encounter_state = ?');
      values.push(fields.encounterState != null ? JSON.stringify(fields.encounterState) : null);
    }
    if ('pastEncounters' in fields) {
      sets.push('past_encounters = ?');
      values.push(fields.pastEncounters && fields.pastEncounters.length > 0 ? JSON.stringify(fields.pastEncounters) : null);
    }
    if ('dmPrepEncounters' in fields) {
      sets.push('dm_prep_encounters = ?');
      values.push(fields.dmPrepEncounters != null ? JSON.stringify(fields.dmPrepEncounters) : null);
    }
    if (sets.length === 0) {
      return;
    }
    db.prepare(`UPDATE sessions SET ${sets.join(', ')} WHERE id = ?`).run(...values, id);
  },

  async patchEncounterEnemyAvatar(
    sessionId: string,
    encounterId: string,
    enemyId: string,
    imageUrl: string,
  ): Promise<void> {
    const db = getDb();
    const row = db.prepare('SELECT encounter_state, past_encounters FROM sessions WHERE id = ?').get(sessionId) as { encounter_state: string | null; past_encounters: string | null } | undefined;
    if (!row) {
      return;
    }
    const encounterState: EncounterState | undefined = row.encounter_state ? JSON.parse(row.encounter_state) : undefined;
    const pastEncounters: EncounterState[] = row.past_encounters ? JSON.parse(row.past_encounters) : [];

    const patchEnemies = (enc: EncounterState): EncounterState => ({
      ...enc,
      enemies: enc.enemies.map(e => e.id === enemyId ? { ...e, avatarUrl: imageUrl } : e),
    });

    const newEncounterState = encounterState?.id === encounterId ? patchEnemies(encounterState) : encounterState;
    const newPastEncounters = pastEncounters.map(enc => enc.id === encounterId ? patchEnemies(enc) : enc);

    db.prepare('UPDATE sessions SET encounter_state = ?, past_encounters = ? WHERE id = ?').run(
      newEncounterState ? JSON.stringify(newEncounterState) : null,
      newPastEncounters.length > 0 ? JSON.stringify(newPastEncounters) : null,
      sessionId,
    );
  },

  async patchEncounterAreaImage(
    sessionId: string,
    encounterId: string,
    areaId: string,
    imageUrl: string,
  ): Promise<void> {
    const db = getDb();
    const row = db.prepare('SELECT encounter_state, past_encounters FROM sessions WHERE id = ?').get(sessionId) as { encounter_state: string | null; past_encounters: string | null } | undefined;
    if (!row) {
      return;
    }
    const encounterState: EncounterState | undefined = row.encounter_state ? JSON.parse(row.encounter_state) : undefined;
    const pastEncounters: EncounterState[] = row.past_encounters ? JSON.parse(row.past_encounters) : [];

    const patchAreas = (enc: EncounterState): EncounterState => ({
      ...enc,
      areas: enc.areas.map(a => a.id === areaId ? { ...a, imageUrl } : a),
    });

    const newEncounterState = encounterState?.id === encounterId ? patchAreas(encounterState) : encounterState;
    const newPastEncounters = pastEncounters.map(enc => enc.id === encounterId ? patchAreas(enc) : enc);

    db.prepare('UPDATE sessions SET encounter_state = ?, past_encounters = ? WHERE id = ?').run(
      newEncounterState ? JSON.stringify(newEncounterState) : null,
      newPastEncounters.length > 0 ? JSON.stringify(newPastEncounters) : null,
      sessionId,
    );
  },

  async listSessions(namespaceId: string = 'local'): Promise<SessionListItem[]> {
    const db = getDb();
    // Last played first: the latest turn's time, or creation time for a session with no
    // turns yet. Every session gets an opening turn, so new sessions sort by when they started.
    const rows = db.prepare(`
      SELECT id, displayName, worldDescription, storySummary, dm_prep, difficulty, gameMode, game_over, preview_image_url, adventure_format, adventure_status
      FROM sessions s
      WHERE namespace_id = ?
      ORDER BY COALESCE((SELECT MAX(t.createdAt) FROM turn_history t WHERE t.sessionId = s.id), s.createdAt) DESC, s.createdAt DESC, s.id ASC
    `).all(namespaceId) as { id: string; displayName: string; worldDescription: string | null; storySummary: string | null; dm_prep: string | null; difficulty: string; gameMode: string; game_over: number; preview_image_url: string | null; adventure_format: string | null; adventure_status: string | null }[];
    return rows.map(row => {
      const chars = db.prepare('SELECT id, name, class, species, avatarUrl, hp, max_hp FROM characters WHERE sessionId = ?').all(row.id) as { id: string; name: string; class: string; species: string; avatarUrl: string | null; hp: number; max_hp: number }[];
      return {
        id: row.id,
        displayName: row.displayName,
        worldDescription: row.worldDescription || undefined,
        storySummary: row.storySummary || undefined,
        dmPrep: row.dm_prep || undefined,
        difficulty: row.difficulty,
        gameMode: row.gameMode,
        gameOver: !!row.game_over || undefined,
        adventureFormat: (row.adventure_format as AdventureFormat | null) ?? 'long_lived',
        adventureStatus: (row.adventure_status as AdventureStatus | null) ?? 'active',
        previewImageUrl: row.preview_image_url || undefined,
        party: chars.map(c => ({ ...c, avatarUrl: c.avatarUrl || undefined })),
      };
    });
  },

  assignSessionToNamespace(sessionId: string, namespaceId: string): boolean {
    const db = getDb();
    const result = db.prepare('UPDATE sessions SET namespace_id = ? WHERE id = ?').run(namespaceId, sessionId);
    return result.changes > 0;
  },

  listSessionsInNamespace(namespaceId: string): { id: string; displayName: string; turn: number; createdAt: string }[] {
    const db = getDb();
    return db.prepare('SELECT id, displayName, turn, createdAt FROM sessions WHERE namespace_id = ? ORDER BY createdAt DESC, id ASC').all(namespaceId) as { id: string; displayName: string; turn: number; createdAt: string }[];
  },

  countSessionsInNamespace(namespaceId: string): number {
    const db = getDb();
    const row = db.prepare('SELECT COUNT(*) as count FROM sessions WHERE namespace_id = ?').get(namespaceId) as { count: number };
    return row.count;
  },

  // sourceTurn is the session turn the summary was built from. A late result built
  // from an older turn never replaces a newer summary.
  async updateStorySummary(sessionId: string, summary: string, sourceTurn?: number): Promise<boolean> {
    const db = getDb();
    if (sourceTurn === undefined) {
      db.prepare('UPDATE sessions SET storySummary = ? WHERE id = ?').run(summary, sessionId);
      return true;
    }
    const result = db.prepare('UPDATE sessions SET storySummary = ?, story_summary_turn = ? WHERE id = ? AND story_summary_turn <= ?')
      .run(summary, sourceTurn, sessionId, sourceTurn);
    return result.changes > 0;
  },

  cloneOnboardingSession(namespaceId: string): string {
    const db = getDb();
    const templateId = 'seed-onboarding-template';

    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(templateId) as {
      scene: string; sceneId: string; worldDescription: string | null; dm_prep: string | null;
      dm_prep_image_brief: string | null; dm_prep_encounters: string | null;
      turn: number; activeCharacterId: string; tone: string; displayName: string;
      difficulty: string; gameMode: string; savingsMode: number;
      storySummary: string; preview_image_url: string | null;
    } | undefined;
    if (!session) {
      throw new Error('Onboarding template not found - run seed first');
    }

    const newSessionId = createId();

    // The onboarding tutorial follows its own scripted flow: explicitly long-lived so
    // it never gains one-evening finale pressure.
    // onboarding_ideas: the first viewer asks for ideas once, by itself.
    db.prepare(`INSERT INTO sessions (id, scene, sceneId, worldDescription, dm_prep, dm_prep_image_brief, dm_prep_encounters, turn, activeCharacterId, tone, displayName, difficulty, gameMode, savingsMode, useLocalAI, interventionUsed, rescues_used, game_over, storySummary, preview_image_url, namespace_id, adventure_format, adventure_status, adventure_arc, onboarding_ideas)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?, ?, 'long_lived', 'active', ?, 'pending')`)
      .run(newSessionId, session.scene, session.sceneId, session.worldDescription, session.dm_prep, session.dm_prep_image_brief, session.dm_prep_encounters, session.turn, '', session.tone, session.displayName, session.difficulty, session.gameMode, session.savingsMode, 0, session.storySummary, session.preview_image_url, namespaceId, serializeArc(createInitialArc()));

    const chars = db.prepare('SELECT * FROM characters WHERE sessionId = ? ORDER BY rowid ASC').all(templateId) as {
      id: string; name: string; class: string; species: string; quirk: string;
      hp: number; max_hp: number; might: number; magic: number; mischief: number;
      avatarUrl: string | null; status: string | null;
    }[];

    const charIdMap = new Map<string, string>();
    for (const char of chars) {
      const newCharId = createId();
      charIdMap.set(char.id, newCharId);

      db.prepare(`INSERT INTO characters (id, sessionId, name, class, species, quirk, hp, max_hp, might, magic, mischief, avatarUrl, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(newCharId, newSessionId, char.name, char.class, char.species, char.quirk, char.hp, char.max_hp, char.might, char.magic, char.mischief, char.avatarUrl, char.status ?? 'active');

      const items = db.prepare('SELECT * FROM inventory WHERE characterId = ?').all(char.id) as {
        name: string; description: string; healValue: number | null;
        statBonuses: string | null; consumable: number; transferable: number;
      }[];
      for (const item of items) {
        db.prepare(`INSERT INTO inventory (characterId, itemId, name, description, healValue, statBonuses, consumable, transferable)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(newCharId, createId(), item.name, item.description, item.healValue, item.statBonuses, item.consumable, item.transferable);
      }
    }

    const newActiveCharId = charIdMap.get(session.activeCharacterId) ?? '';
    db.prepare('UPDATE sessions SET activeCharacterId = ? WHERE id = ?').run(newActiveCharId, newSessionId);

    const turns = db.prepare('SELECT * FROM turn_history WHERE sessionId = ? ORDER BY id ASC').all(templateId) as {
      id: number; characterId: string | null; encounterId: string | null; narration: string; rollNarration: string | null;
      imagePrompt: string | null; imageSuggested: number; imageUrl: string | null;
      actionAttempt: string | null; actionStat: string | null; actionSuccess: number | null;
      actionRoll: number | null; actionStatBonus: number | null; actionImpact: string | null;
      actionDifficultyTarget: number | null; turnType: string; currentTensionLevel: string | null;
      hpChanges: string | null; inventoryChanges: string | null;
    }[];

    for (const turn of turns) {
      const newCharId = turn.characterId ? (charIdMap.get(turn.characterId) ?? null) : null;
      const info = db.prepare(`INSERT INTO turn_history (sessionId, characterId, encounterId, narration, rollNarration, imagePrompt, imageSuggested, imageUrl, actionAttempt, actionStat, actionSuccess, actionRoll, actionStatBonus, actionImpact, actionDifficultyTarget, turnType, currentTensionLevel, hpChanges, inventoryChanges)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(newSessionId, newCharId, turn.encounterId, turn.narration, turn.rollNarration, turn.imagePrompt, turn.imageSuggested, turn.imageUrl, turn.actionAttempt, turn.actionStat, turn.actionSuccess, turn.actionRoll, turn.actionStatBonus, turn.actionImpact, turn.actionDifficultyTarget, turn.turnType, turn.currentTensionLevel, turn.hpChanges, turn.inventoryChanges);

      const newTurnId = info.lastInsertRowid;
      const choices = db.prepare('SELECT * FROM turn_choices WHERE turnId = ?').all(turn.id) as {
        label: string; difficulty: string; stat: string; difficultyValue: number | null;
        narration: string | null; flavor: string | null; helperCharacterName: string | null;
        itemOwnerName: string | null; itemName: string | null; environmentFeature: string | null;
      }[];
      for (const choice of choices) {
        db.prepare(`INSERT INTO turn_choices (turnId, label, difficulty, stat, difficultyValue, narration, flavor, helperCharacterName, itemOwnerName, itemName, environmentFeature)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(newTurnId, choice.label, choice.difficulty, choice.stat, choice.difficultyValue, choice.narration, choice.flavor, choice.helperCharacterName, choice.itemOwnerName, choice.itemName, choice.environmentFeature);
      }
    }

    return newSessionId;
  },
};
