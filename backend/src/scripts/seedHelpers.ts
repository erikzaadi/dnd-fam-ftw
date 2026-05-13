import type { Database as DB } from 'libsql';
import { ImageService } from '../services/imageService.js';
import type { Choice, Impact } from '../types.js';

export type SeedChoice = Omit<Choice, 'difficulty' | 'stat'> & { difficulty: string; stat: string };

export interface SessionSeed {
  seed(db: DB): void;
}

export function deleteSession(db: DB, id: string): void {
  db.prepare('DELETE FROM turn_choices WHERE turnId IN (SELECT id FROM turn_history WHERE sessionId = ?)').run(id);
  db.prepare('DELETE FROM turn_history WHERE sessionId = ?').run(id);
  db.prepare('DELETE FROM inventory WHERE characterId IN (SELECT id FROM characters WHERE sessionId = ?)').run(id);
  db.prepare('DELETE FROM characters WHERE sessionId = ?').run(id);
  db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
}

export function seedChar(
  db: DB,
  sessionId: string,
  id: string,
  name: string,
  cls: string,
  species: string,
  quirk: string,
  might: number,
  magic: number,
  mischief: number,
  hp: number,
  maxHp: number,
  status: 'active' | 'downed' = 'active',
  avatarUrl?: string,
): void {
  db.prepare('DELETE FROM inventory WHERE characterId = ?').run(id);
  db.prepare('DELETE FROM characters WHERE id = ?').run(id);
  const resolvedAvatarUrl = avatarUrl ?? ImageService.generateInitialsSvg(name, sessionId);
  db.prepare(`INSERT INTO characters (id, sessionId, name, class, species, quirk, hp, max_hp, might, magic, mischief, status, avatarUrl)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, sessionId, name, cls, species, quirk, hp, maxHp, might, magic, mischief, status, resolvedAvatarUrl);
}

export function seedItem(
  db: DB,
  characterId: string,
  itemId: string,
  name: string,
  description: string,
  healValue: number | null,
  statBonuses: string | null,
  consumable: number,
  transferable: number,
): void {
  db.prepare(`INSERT INTO inventory (characterId, itemId, name, description, healValue, statBonuses, consumable, transferable)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(characterId, itemId, name, description, healValue, statBonuses, consumable, transferable);
}

export function seedTurn(
  db: DB,
  sessionId: string,
  characterId: string | null,
  narration: string,
  choices: SeedChoice[],
  actionAttempt: string | null,
  actionStat: string | null,
  actionSuccess: number | null,
  actionRoll: number | null,
  actionStatBonus: number | null,
  turnType: string = 'normal',
  imageUrl: string | null = null,
  actionDifficultyTarget: number | null = null,
  rollNarration: string | null = null,
  currentTensionLevel: string | null = null,
  hpChanges: string | null = null,
  inventoryChanges: string | null = null,
  actionImpact: Impact | null = null,
  actionDetails: {
    itemBonus?: number;
    helperBonus?: number;
    helperCharacterName?: string;
    choiceItemBonus?: number;
    choiceItemName?: string;
    choiceItemOwnerName?: string;
    characterBonus?: number;
    characterBonusLabel?: string;
  } = {},
): void {
  const info = db.prepare(`INSERT INTO turn_history (sessionId, characterId, narration, rollNarration, imagePrompt, imageSuggested, imageUrl, actionAttempt, actionStat, actionSuccess, actionRoll, actionStatBonus, actionItemBonus, actionHelperBonus, actionHelperCharacterName, actionChoiceItemBonus, actionChoiceItemName, actionChoiceItemOwnerName, actionCharacterBonus, actionCharacterBonusLabel, actionImpact, actionDifficultyTarget, turnType, currentTensionLevel, hpChanges, inventoryChanges)
    VALUES (?, ?, ?, ?, NULL, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      sessionId, characterId, narration, rollNarration, imageUrl, actionAttempt, actionStat, actionSuccess, actionRoll, actionStatBonus,
      actionDetails.itemBonus ?? null,
      actionDetails.helperBonus ?? null,
      actionDetails.helperCharacterName ?? null,
      actionDetails.choiceItemBonus ?? null,
      actionDetails.choiceItemName ?? null,
      actionDetails.choiceItemOwnerName ?? null,
      actionDetails.characterBonus ?? null,
      actionDetails.characterBonusLabel ?? null,
      actionImpact, actionDifficultyTarget, turnType, currentTensionLevel, hpChanges, inventoryChanges,
    );
  const turnId = info.lastInsertRowid;
  for (const c of choices) {
    db.prepare(`INSERT INTO turn_choices (turnId, label, difficulty, stat, difficultyValue, narration, flavor, helperCharacterName, itemOwnerName, itemName, environmentFeature) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        turnId, c.label, c.difficulty, c.stat, c.difficultyValue ?? null, c.narration ?? null,
        c.flavor ?? null, c.helperCharacterName ?? null, c.itemOwnerName ?? null, c.itemName ?? null, c.environmentFeature ?? null,
      );
  }
}

export const CHOICES_COMBAT: SeedChoice[] = [
  { label: 'Strike with your weapon', difficulty: 'normal', stat: 'might', difficultyValue: 12 },
  { label: 'Cast a spell', difficulty: 'normal', stat: 'magic', difficultyValue: 11 },
  { label: 'Dodge and find an opening', difficulty: 'hard', stat: 'mischief', difficultyValue: 15 },
];

export const CHOICES_EXPLORE: SeedChoice[] = [
  { label: 'Search the area carefully', difficulty: 'easy', stat: 'mischief', difficultyValue: 8 },
  { label: 'Examine with magic', difficulty: 'normal', stat: 'magic', difficultyValue: 11 },
  { label: 'Force it open', difficulty: 'normal', stat: 'might', difficultyValue: 13 },
];

export const CHOICES_SOCIAL: SeedChoice[] = [
  { label: 'Persuade them', difficulty: 'normal', stat: 'mischief', difficultyValue: 11 },
  { label: 'Intimidate them', difficulty: 'normal', stat: 'might', difficultyValue: 12 },
  { label: 'Read their aura', difficulty: 'hard', stat: 'magic', difficultyValue: 14 },
];
