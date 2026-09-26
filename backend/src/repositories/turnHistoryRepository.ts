import { getDb } from '../persistence/database.js';
import { getImageStorageProvider } from '../providers/storage/storageProviderFactory.js';
import { TurnResult, type Difficulty, type Impact, type Stat } from '../types.js';

type TurnHistoryRow = {
  id: number;
  encounterId: string | null;
  narration: string;
  rollNarration: string | null;
  imagePrompt: string | null;
  imageSuggested: number;
  imageUrl: string | null;
  image_storage_key: string | null;
  image_storage_provider: string | null;
  characterId: string | null;
  actionAttempt: string | null;
  actionStat: string | null;
  actionSuccess: number | null;
  actionRoll: number | null;
  actionStatBonus: number | null;
  actionItemBonus: number | null;
  actionHelperBonus: number | null;
  actionHelperCharacterName: string | null;
  actionChoiceItemBonus: number | null;
  actionChoiceItemName: string | null;
  actionChoiceItemOwnerName: string | null;
  actionCharacterBonus: number | null;
  actionCharacterBonusLabel: string | null;
  actionBuffBonus: number | null;
  actionBuffBonusLabel: string | null;
  actionIsCritical: number | null;
  actionImpact: string | null;
  actionDifficultyTarget: number | null;
  turnType: string | null;
  currentTensionLevel: string | null;
  hpChanges: string | null;
  inventoryChanges: string | null;
  narrationRetried: number | null;
  narrationFailed: number | null;
  choicesFailed: number | null;
  narrationValidationError: string | null;
  narrationRetryValidationError: string | null;
  encounterEnemyChanges: string | null;
  buffChanges: string | null;
  ideas_revision: number | null;
  ideas_character_id: string | null;
  ideas_degraded: number | null;
};

const mapTurnHistoryRow = (row: TurnHistoryRow): TurnResult => {
  const db = getDb();
  const choices = db.prepare('SELECT * FROM turn_choices WHERE turnId = ? ORDER BY id').all(row.id) as {
    id: number;
    turnId: number;
    label: string;
    difficulty: Difficulty;
    stat: Stat;
    difficultyValue: number | null;
    narration: string | null;
    riddleAnswer: string | null;
    riddleCorrect: number | null;
    flavor: TurnResult['choices'][number]['flavor'] | null;
    helperCharacterName: string | null;
    itemOwnerName: string | null;
    itemName: string | null;
    environmentFeature: string | null;
  }[];
  const rollTotal = (row.actionRoll ?? 0) + (row.actionStatBonus ?? 0) + (row.actionItemBonus ?? 0) + (row.actionHelperBonus ?? 0) + (row.actionChoiceItemBonus ?? 0) + (row.actionCharacterBonus ?? 0) + (row.actionBuffBonus ?? 0);
  const margin = row.actionDifficultyTarget != null
    ? (row.actionSuccess ? rollTotal - row.actionDifficultyTarget : row.actionDifficultyTarget - rollTotal)
    : 0;
  const derivedImpact: Impact = row.actionRoll === 1 || row.actionIsCritical || row.actionRoll === 20 || margin >= 12
    ? 'extreme'
    : margin >= 8
      ? 'strong'
      : 'normal';
  const lastAction = row.actionAttempt ? {
    actionAttempt: row.actionAttempt,
    actionResult: {
      success: !!row.actionSuccess,
      roll: row.actionRoll ?? 0,
      statUsed: (row.actionStat ?? 'none') as Stat | 'none',
      ...(row.actionStatBonus != null && { statBonus: row.actionStatBonus }),
      ...(row.actionItemBonus != null && row.actionItemBonus > 0 && { itemBonus: row.actionItemBonus }),
      ...(row.actionHelperBonus != null && row.actionHelperBonus > 0 && { helperBonus: row.actionHelperBonus }),
      ...(row.actionHelperCharacterName && { helperCharacterName: row.actionHelperCharacterName }),
      ...(row.actionChoiceItemBonus != null && row.actionChoiceItemBonus > 0 && { choiceItemBonus: row.actionChoiceItemBonus }),
      ...(row.actionChoiceItemName && { choiceItemName: row.actionChoiceItemName }),
      ...(row.actionChoiceItemOwnerName && { choiceItemOwnerName: row.actionChoiceItemOwnerName }),
      ...(row.actionCharacterBonus != null && row.actionCharacterBonus > 0 && { characterBonus: row.actionCharacterBonus }),
      ...(row.actionCharacterBonusLabel && { characterBonusLabel: row.actionCharacterBonusLabel }),
      ...(row.actionBuffBonus != null && row.actionBuffBonus !== 0 && { buffBonus: row.actionBuffBonus }),
      ...(row.actionBuffBonusLabel && { buffBonusLabel: row.actionBuffBonusLabel }),
      impact: (row.actionImpact ?? derivedImpact) as Impact,
      ...(row.actionIsCritical && { isCritical: true }),
      ...(row.actionDifficultyTarget != null && { difficultyTarget: row.actionDifficultyTarget }),
    },
  } : null;

  // Recompute image URL from storage key so URLs always reflect current config.
  // Heals rows that were written before S3_IMAGE_PUBLIC_BASE_URL was set.
  let imageUrl = row.imageUrl;
  if (row.image_storage_key && row.image_storage_provider === 's3') {
    const storage = getImageStorageProvider();
    imageUrl = storage.getPublicUrl(row.image_storage_key);
  }

  return {
    id: row.id,
    ...(row.encounterId && { encounterId: row.encounterId }),
    narration: row.narration,
    rollNarration: row.rollNarration || undefined,
    imagePrompt: row.imagePrompt,
    imageSuggested: !!row.imageSuggested,
    imageUrl,
    characterId: row.characterId || undefined,
    choices: choices.map(({ turnId: _turnId, difficultyValue, narration, riddleAnswer, riddleCorrect, flavor, helperCharacterName, itemOwnerName, itemName, environmentFeature, ...choice }) => ({
      ...choice,
      ...(difficultyValue != null && { difficultyValue }),
      ...(narration != null && { narration }),
      ...(riddleAnswer != null && { riddleAnswer }),
      ...(riddleCorrect != null && { riddleCorrect: !!riddleCorrect }),
      ...(flavor != null && { flavor }),
      ...(helperCharacterName != null && { helperCharacterName }),
      ...(itemOwnerName != null && { itemOwnerName }),
      ...(itemName != null && { itemName }),
      ...(environmentFeature != null && { environmentFeature }),
    })),
    lastAction,
    turnType: (row.turnType as TurnResult['turnType']) ?? 'normal',
    ...(row.currentTensionLevel && { currentTensionLevel: row.currentTensionLevel as TurnResult['currentTensionLevel'] }),
    ...(row.hpChanges && { hpChanges: JSON.parse(row.hpChanges) }),
    ...(row.inventoryChanges && { inventoryChanges: JSON.parse(row.inventoryChanges) }),
    ...(row.narrationRetried != null && { narrationRetried: !!row.narrationRetried }),
    ...(row.narrationFailed != null && { narrationFailed: !!row.narrationFailed }),
    ...(row.choicesFailed != null && { choicesFailed: !!row.choicesFailed }),
    ...(row.narrationValidationError && { narrationValidationError: row.narrationValidationError }),
    ...(row.narrationRetryValidationError && { narrationRetryValidationError: row.narrationRetryValidationError }),
    ...(row.encounterEnemyChanges && { encounterEnemyChanges: JSON.parse(row.encounterEnemyChanges) }),
    ...(row.buffChanges && { buffChanges: JSON.parse(row.buffChanges) }),
    ...(row.ideas_revision != null && { ideasRevision: row.ideas_revision }),
    ...(row.ideas_character_id && { ideasCharacterId: row.ideas_character_id }),
    ...(row.ideas_degraded && { ideasDegraded: true }),
  };
};

export type TurnIdeasMeta = {
  turnId: number;
  ideasRevision: number | null;
  ideasCharacterId: string | null;
  ideasDegraded: boolean;
};

// Stale ideas are hidden and cannot be submitted. Turns from before ideas existed carry
// no metadata and stay current while they are the latest turn.
export const areIdeasCurrent = (meta: Pick<TurnIdeasMeta, 'ideasRevision' | 'ideasCharacterId'>, session: { revision?: number; activeCharacterId: string }): boolean =>
  meta.ideasRevision == null
  || (meta.ideasRevision === (session.revision ?? 0) && (!meta.ideasCharacterId || meta.ideasCharacterId === session.activeCharacterId));

const insertChoicesSync = (turnId: number | bigint, choices: TurnResult['choices']): void => {
  const db = getDb();
  for (const choice of choices) {
    const choiceInfo = db.prepare('INSERT INTO turn_choices (turnId, label, difficulty, stat, difficultyValue, narration, riddleAnswer, riddleCorrect, flavor, helperCharacterName, itemOwnerName, itemName, environmentFeature) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(
        turnId,
        choice.label,
        choice.difficulty,
        choice.stat,
        choice.difficultyValue ?? null,
        choice.narration ?? null,
        choice.riddleAnswer ?? null,
        choice.riddleCorrect == null ? null : (choice.riddleCorrect ? 1 : 0),
        choice.flavor ?? null,
        choice.helperCharacterName ?? null,
        choice.itemOwnerName ?? null,
        choice.itemName ?? null,
        choice.environmentFeature ?? null,
      );
    // Hand the stable id back so the broadcast turn can be answered by choice id.
    choice.id = Number(choiceInfo.lastInsertRowid);
  }
};

export const turnHistoryRepository = {
  async getTurnHistory(sessionId: string): Promise<TurnResult[]> {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM turn_history WHERE sessionId = ?').all(sessionId) as TurnHistoryRow[];
    return rows.map(mapTurnHistoryRow);
  },

  // Attaches an image to one exact turn. Returns false when the turn no longer exists
  // (for example the session was deleted while the image was generating).
  async updateTurnImage(sessionId: string, turnId: number, imageUrl: string, storageKey: string, storageProvider: string): Promise<boolean> {
    const db = getDb();
    const result = db.prepare('UPDATE turn_history SET imageUrl = ?, image_storage_key = ?, image_storage_provider = ? WHERE id = ? AND sessionId = ?')
      .run(imageUrl, storageKey || null, storageProvider || null, turnId, sessionId);
    return result.changes > 0;
  },

  async addTurnResult(sessionId: string, turn: TurnResult, characterId: string | null): Promise<number> {
    return turnHistoryRepository.insertTurnResultSync(sessionId, turn, characterId);
  },

  // Synchronous so it can participate in commitTurn's transaction.
  insertTurnResultSync(sessionId: string, turn: TurnResult, characterId: string | null, operationId?: string): number {
    const db = getDb();
    const action = turn.lastAction ?? null;
    const info = db.prepare('INSERT INTO turn_history (sessionId, characterId, encounterId, narration, rollNarration, imagePrompt, imageSuggested, imageUrl, actionAttempt, actionStat, actionSuccess, actionRoll, actionStatBonus, actionItemBonus, actionHelperBonus, actionHelperCharacterName, actionChoiceItemBonus, actionChoiceItemName, actionChoiceItemOwnerName, actionCharacterBonus, actionCharacterBonusLabel, actionBuffBonus, actionBuffBonusLabel, actionIsCritical, actionImpact, actionDifficultyTarget, turnType, currentTensionLevel, hpChanges, inventoryChanges, narrationRetried, narrationFailed, narrationValidationError, narrationRetryValidationError, encounterEnemyChanges, buffChanges, choicesFailed, operation_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(sessionId, characterId || null, turn.encounterId ?? null, turn.narration, turn.rollNarration || null, turn.imagePrompt, turn.imageSuggested ? 1 : 0, turn.imageUrl || null,
        action?.actionAttempt ?? null,
        action?.actionResult?.statUsed ?? null,
        action?.actionResult?.success ? 1 : 0,
        action?.actionResult?.roll ?? null,
        action?.actionResult?.statBonus ?? null,
        action?.actionResult?.itemBonus ?? null,
        action?.actionResult?.helperBonus ?? null,
        action?.actionResult?.helperCharacterName ?? null,
        action?.actionResult?.choiceItemBonus ?? null,
        action?.actionResult?.choiceItemName ?? null,
        action?.actionResult?.choiceItemOwnerName ?? null,
        action?.actionResult?.characterBonus ?? null,
        action?.actionResult?.characterBonusLabel ?? null,
        action?.actionResult?.buffBonus ?? null,
        action?.actionResult?.buffBonusLabel ?? null,
        action?.actionResult?.isCritical ? 1 : null,
        action?.actionResult?.impact ?? null,
        action?.actionResult?.difficultyTarget ?? null,
        turn.turnType ?? 'normal',
        turn.currentTensionLevel ?? null,
        turn.hpChanges && turn.hpChanges.length > 0 ? JSON.stringify(turn.hpChanges) : null,
        turn.inventoryChanges && turn.inventoryChanges.length > 0 ? JSON.stringify(turn.inventoryChanges) : null,
        turn.narrationRetried ? 1 : 0,
        turn.narrationFailed ? 1 : 0,
        turn.narrationValidationError ?? null,
        turn.narrationRetryValidationError ?? null,
        turn.encounterEnemyChanges && turn.encounterEnemyChanges.length > 0 ? JSON.stringify(turn.encounterEnemyChanges) : null,
        turn.buffChanges && turn.buffChanges.length > 0 ? JSON.stringify(turn.buffChanges) : null,
        turn.choicesFailed ? 1 : 0,
        operationId ?? null,
      );

    const turnId = info.lastInsertRowid;
    insertChoicesSync(turnId, turn.choices ?? []);
    return Number(turnId);
  },

  // Stamps which revision and acting hero a turn's choices belong to (commitTurn).
  setIdeasMetaSync(turnId: number, revision: number, characterId: string, degraded: boolean): void {
    getDb().prepare('UPDATE turn_history SET ideas_revision = ?, ideas_character_id = ?, ideas_degraded = ? WHERE id = ?')
      .run(revision, characterId || null, degraded ? 1 : 0, turnId);
  },

  // Replaces a turn's choices with freshly generated ideas. Synchronous so the ideas
  // service can run it inside a transaction with its currency checks.
  replaceIdeasSync(turnId: number, choices: TurnResult['choices'], revision: number, characterId: string, degraded: boolean): void {
    getDb().prepare('DELETE FROM turn_choices WHERE turnId = ?').run(turnId);
    insertChoicesSync(turnId, choices);
    turnHistoryRepository.setIdeasMetaSync(turnId, revision, characterId, degraded);
  },

  getLatestIdeasMeta(sessionId: string): TurnIdeasMeta | null {
    const row = getDb().prepare('SELECT id, ideas_revision, ideas_character_id, ideas_degraded FROM turn_history WHERE sessionId = ? ORDER BY id DESC LIMIT 1')
      .get(sessionId) as { id: number; ideas_revision: number | null; ideas_character_id: string | null; ideas_degraded: number | null } | undefined;
    return row
      ? { turnId: row.id, ideasRevision: row.ideas_revision, ideasCharacterId: row.ideas_character_id, ideasDegraded: !!row.ideas_degraded }
      : null;
  },

  getCharacterTurnHistory(characterId: string): { narration: string; actionAttempt: string | null }[] {
    const db = getDb();
    return db.prepare('SELECT narration, actionAttempt FROM turn_history WHERE characterId = ? ORDER BY id').all(characterId) as { narration: string; actionAttempt: string | null }[];
  },

  getNarration(turnId: number): string | null {
    const row = getDb().prepare('SELECT narration FROM turn_history WHERE id = ?').get(turnId) as { narration: string } | undefined;
    return row?.narration ?? null;
  },

  // Server-owned image reference of one turn (never sent to clients as a path).
  getTurnImageRef(sessionId: string, turnId: number): { imageUrl: string | null; storageKey: string | null; narration: string; imagePrompt: string | null; tension: string | null } | null {
    const row = getDb().prepare('SELECT imageUrl, image_storage_key, narration, imagePrompt, currentTensionLevel FROM turn_history WHERE sessionId = ? AND id = ?').get(sessionId, turnId) as
      { imageUrl: string | null; image_storage_key: string | null; narration: string; imagePrompt: string | null; currentTensionLevel: string | null } | undefined;
    return row ? { imageUrl: row.imageUrl, storageKey: row.image_storage_key, narration: row.narration, imagePrompt: row.imagePrompt, tension: row.currentTensionLevel } : null;
  },

  // Turns committed by one operation (an action can add rescue or ending turns too).
  getTurnsForOperation(sessionId: string, operationId: string): TurnResult[] {
    const rows = getDb().prepare('SELECT * FROM turn_history WHERE sessionId = ? AND operation_id = ? ORDER BY id').all(sessionId, operationId) as TurnHistoryRow[];
    return rows.map(mapTurnHistoryRow);
  },

  getLatestTurnId(sessionId: string): number | null {
    const row = getDb().prepare('SELECT id FROM turn_history WHERE sessionId = ? ORDER BY id DESC LIMIT 1').get(sessionId) as { id: number } | undefined;
    return row?.id ?? null;
  },
};
