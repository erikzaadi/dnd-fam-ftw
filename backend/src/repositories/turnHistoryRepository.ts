import { getDb } from '../persistence/database.js';
import { getImageStorageProvider } from '../providers/storage/storageProviderFactory.js';
import { TurnResult, type Difficulty, type Impact, type Stat } from '../types.js';

type TurnHistoryRow = {
  id: number;
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
  actionIsCritical: number | null;
  actionImpact: string | null;
  actionDifficultyTarget: number | null;
  turnType: string | null;
  currentTensionLevel: string | null;
  hpChanges: string | null;
  inventoryChanges: string | null;
};

const mapTurnHistoryRow = (row: TurnHistoryRow): TurnResult => {
  const db = getDb();
  const choices = db.prepare('SELECT * FROM turn_choices WHERE turnId = ?').all(row.id) as {
    label: string;
    difficulty: Difficulty;
    stat: Stat;
    difficultyValue: number | null;
    narration: string | null;
  }[];
  const rollTotal = (row.actionRoll ?? 0) + (row.actionStatBonus ?? 0) + (row.actionItemBonus ?? 0);
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
    narration: row.narration,
    rollNarration: row.rollNarration || undefined,
    imagePrompt: row.imagePrompt,
    imageSuggested: !!row.imageSuggested,
    imageUrl,
    characterId: row.characterId || undefined,
    choices: choices.map(({ difficultyValue, narration, ...choice }) => ({
      ...choice,
      ...(difficultyValue != null && { difficultyValue }),
      ...(narration != null && { narration }),
    })),
    lastAction,
    turnType: (row.turnType as TurnResult['turnType']) ?? 'normal',
    ...(row.currentTensionLevel && { currentTensionLevel: row.currentTensionLevel as TurnResult['currentTensionLevel'] }),
    ...(row.hpChanges && { hpChanges: JSON.parse(row.hpChanges) }),
    ...(row.inventoryChanges && { inventoryChanges: JSON.parse(row.inventoryChanges) }),
  };
};

export const turnHistoryRepository = {
  async getTurnHistory(sessionId: string): Promise<TurnResult[]> {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM turn_history WHERE sessionId = ?').all(sessionId) as TurnHistoryRow[];
    return rows.map(mapTurnHistoryRow);
  },

  async updateLatestTurnImage(sessionId: string, imageUrl: string, storageKey: string, storageProvider: string): Promise<void> {
    const db = getDb();
    db.prepare('UPDATE turn_history SET imageUrl = ?, image_storage_key = ?, image_storage_provider = ? WHERE id = (SELECT MAX(id) FROM turn_history WHERE sessionId = ?)')
      .run(imageUrl, storageKey || null, storageProvider || null, sessionId);
  },

  async addTurnResult(sessionId: string, turn: TurnResult, characterId: string | null): Promise<number> {
    const db = getDb();
    const action = turn.lastAction ?? null;
    const info = db.prepare('INSERT INTO turn_history (sessionId, characterId, narration, rollNarration, imagePrompt, imageSuggested, imageUrl, actionAttempt, actionStat, actionSuccess, actionRoll, actionStatBonus, actionItemBonus, actionIsCritical, actionImpact, actionDifficultyTarget, turnType, currentTensionLevel, hpChanges, inventoryChanges) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(
        sessionId, characterId || null, turn.narration, turn.rollNarration || null, turn.imagePrompt, turn.imageSuggested ? 1 : 0, turn.imageUrl || null,
        action?.actionAttempt ?? null,
        action?.actionResult?.statUsed ?? null,
        action?.actionResult?.success ? 1 : 0,
        action?.actionResult?.roll ?? null,
        action?.actionResult?.statBonus ?? null,
        action?.actionResult?.itemBonus ?? null,
        action?.actionResult?.isCritical ? 1 : null,
        action?.actionResult?.impact ?? null,
        action?.actionResult?.difficultyTarget ?? null,
        turn.turnType ?? 'normal',
        turn.currentTensionLevel ?? null,
        turn.hpChanges && turn.hpChanges.length > 0 ? JSON.stringify(turn.hpChanges) : null,
        turn.inventoryChanges && turn.inventoryChanges.length > 0 ? JSON.stringify(turn.inventoryChanges) : null,
      );

    const turnId = info.lastInsertRowid;
    for (const choice of (turn.choices ?? [])) {
      db.prepare('INSERT INTO turn_choices (turnId, label, difficulty, stat, difficultyValue, narration) VALUES (?, ?, ?, ?, ?, ?)')
        .run(turnId, choice.label, choice.difficulty, choice.stat, choice.difficultyValue ?? null, choice.narration ?? null);
    }
    return Number(turnId);
  },

  getCharacterTurnHistory(characterId: string): { narration: string; actionAttempt: string | null }[] {
    const db = getDb();
    return db.prepare('SELECT narration, actionAttempt FROM turn_history WHERE characterId = ? ORDER BY id').all(characterId) as { narration: string; actionAttempt: string | null }[];
  },
};
