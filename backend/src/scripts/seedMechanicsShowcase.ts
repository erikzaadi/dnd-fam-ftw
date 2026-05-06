import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import Database, { type Database as DB } from 'libsql';
import { getConfig } from '../config/env.js';
import { StateService } from '../services/stateService.js';
import { ImageService } from '../services/imageService.js';
import type { Choice, Impact } from '../types.js';

dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '.env'), quiet: true });

export const MECHANICS_SHOWCASE_SESSION_ID = 'seed-session-7';
const LEGACY_SESSION_ID = 'seed-session-mechanics-showcase';

type SeedChoice = Omit<Choice, 'difficulty' | 'stat'> & { difficulty: string; stat: string };

function seedChar(db: DB, sessionId: string, id: string, name: string, cls: string, species: string, quirk: string, might: number, magic: number, mischief: number, hp: number, maxHp: number) {
  db.prepare('DELETE FROM inventory WHERE characterId = ?').run(id);
  db.prepare('DELETE FROM characters WHERE id = ?').run(id);
  const avatarUrl = ImageService.generateInitialsSvg(name, sessionId);
  db.prepare(`INSERT INTO characters (id, sessionId, name, class, species, quirk, hp, max_hp, might, magic, mischief, status, avatarUrl)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`)
    .run(id, sessionId, name, cls, species, quirk, hp, maxHp, might, magic, mischief, avatarUrl);
}

function seedItem(db: DB, characterId: string, itemId: string, name: string, description: string, statBonuses: string | null, transferable: number) {
  db.prepare(`INSERT INTO inventory (characterId, itemId, name, description, healValue, statBonuses, consumable, transferable)
    VALUES (?, ?, ?, ?, NULL, ?, 0, ?)`)
    .run(characterId, itemId, name, description, statBonuses, transferable);
}

function seedTurn(db: DB, sessionId: string, characterId: string | null, narration: string, choices: SeedChoice[], actionAttempt: string | null, actionStat: string | null, actionSuccess: number | null, actionRoll: number | null, actionStatBonus: number | null, actionDifficultyTarget: number | null, rollNarration: string | null, currentTensionLevel: string | null, inventoryChanges: string | null = null, actionImpact: Impact | null = null, actionDetails: {
  itemBonus?: number;
  helperBonus?: number;
  helperCharacterName?: string;
  choiceItemBonus?: number;
  choiceItemName?: string;
  choiceItemOwnerName?: string;
  characterBonus?: number;
  characterBonusLabel?: string;
} = {}) {
  const info = db.prepare(`INSERT INTO turn_history (sessionId, characterId, narration, rollNarration, imagePrompt, imageSuggested, imageUrl, actionAttempt, actionStat, actionSuccess, actionRoll, actionStatBonus, actionItemBonus, actionHelperBonus, actionHelperCharacterName, actionChoiceItemBonus, actionChoiceItemName, actionChoiceItemOwnerName, actionCharacterBonus, actionCharacterBonusLabel, actionImpact, actionDifficultyTarget, turnType, currentTensionLevel, hpChanges, inventoryChanges)
    VALUES (?, ?, ?, ?, NULL, 0, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'normal', ?, NULL, ?)`)
    .run(
      sessionId, characterId, narration, rollNarration, actionAttempt, actionStat, actionSuccess, actionRoll, actionStatBonus,
      actionDetails.itemBonus ?? null,
      actionDetails.helperBonus ?? null,
      actionDetails.helperCharacterName ?? null,
      actionDetails.choiceItemBonus ?? null,
      actionDetails.choiceItemName ?? null,
      actionDetails.choiceItemOwnerName ?? null,
      actionDetails.characterBonus ?? null,
      actionDetails.characterBonusLabel ?? null,
      actionImpact, actionDifficultyTarget, currentTensionLevel, inventoryChanges
    );
  const turnId = info.lastInsertRowid;
  for (const choice of choices) {
    db.prepare(`INSERT INTO turn_choices (turnId, label, difficulty, stat, difficultyValue, narration, flavor, helperCharacterName, itemOwnerName, itemName, environmentFeature)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        turnId, choice.label, choice.difficulty, choice.stat, choice.difficultyValue ?? null, choice.narration ?? null,
        choice.flavor ?? null, choice.helperCharacterName ?? null, choice.itemOwnerName ?? null, choice.itemName ?? null, choice.environmentFeature ?? null
      );
  }
}

function deleteSession(db: DB, id: string) {
  db.prepare('DELETE FROM turn_choices WHERE turnId IN (SELECT id FROM turn_history WHERE sessionId = ?)').run(id);
  db.prepare('DELETE FROM turn_history WHERE sessionId = ?').run(id);
  db.prepare('DELETE FROM inventory WHERE characterId IN (SELECT id FROM characters WHERE sessionId = ?)').run(id);
  db.prepare('DELETE FROM characters WHERE sessionId = ?').run(id);
  db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
}

export function seedMechanicsShowcase(db: DB): void {
  deleteSession(db, LEGACY_SESSION_ID);
  deleteSession(db, MECHANICS_SHOWCASE_SESSION_ID);
  db.prepare(`INSERT INTO sessions (id, scene, sceneId, displayName, turn, activeCharacterId, tone, difficulty, gameMode, savingsMode, useLocalAI, interventionUsed, rescues_used, game_over, storySummary, dm_prep)
    VALUES (?, 'The Clockwork Bridge', 'mechanics-showcase', 'Mechanics Showcase', 4, 'seed-s7-c1', 'clear test fixture', 'normal', 'fast', 1, 0, 0, 0, 0, ?, NULL)`)
    .run(MECHANICS_SHOWCASE_SESSION_ID, 'A deterministic fixture for Playwright visual assertions around choice flavors, roll breakdowns, and narration scroll behavior.');

  seedChar(db, MECHANICS_SHOWCASE_SESSION_ID, 'seed-s7-c1', 'Pip Gearwise', 'Rogue', 'Halfling', 'Keeps a checklist for every risky idea', 1, 2, 4, 8, 10);
  seedChar(db, MECHANICS_SHOWCASE_SESSION_ID, 'seed-s7-c2', 'Zara Brightspell', 'Mage', 'Elf', 'Times every spell with a wink', 1, 5, 1, 7, 10);
  seedChar(db, MECHANICS_SHOWCASE_SESSION_ID, 'seed-s7-c3', 'Mira Ironleaf', 'Ranger', 'Human', 'Names every useful knot', 3, 1, 3, 9, 10);
  seedChar(db, MECHANICS_SHOWCASE_SESSION_ID, 'seed-s7-c4', 'Oswin Bell', 'Cleric', 'Human', 'Apologizes before ringing any bell', 2, 4, 1, 9, 10);

  seedItem(db, 'seed-s7-c1', 's7-brass-compass', 'Brass Compass', 'Points toward hidden mechanisms', JSON.stringify({ mischief: 1 }), 0);
  seedItem(db, 'seed-s7-c2', 's7-moon-lens', 'Moon Lens', 'Focuses pale light onto invisible marks', JSON.stringify({ magic: 1 }), 0);
  seedItem(db, 'seed-s7-c3', 's7-anchor-rope', 'Anchor Rope', 'Locks onto stone when thrown carefully', null, 1);

  const choices: SeedChoice[] = [
    { label: 'Time the jump while Zara steadies the spell', difficulty: 'normal', stat: 'mischief', difficultyValue: 13, narration: 'A clean team-up can cross the moving gears.', flavor: 'combo', helperCharacterName: 'Zara Brightspell' },
    { label: 'Hook Mira\'s anchor rope to the gear rail', difficulty: 'normal', stat: 'mischief', difficultyValue: 13, narration: 'Marked gear can make the crossing safer.', flavor: 'item', itemOwnerName: 'Mira Ironleaf', itemName: 'Anchor Rope' },
    { label: 'Charm the bridge keeper with Pip\'s checklist', difficulty: 'normal', stat: 'mischief', difficultyValue: 12, narration: 'A social read can turn suspicion into help.', flavor: 'social' },
    { label: 'Duck under the swinging counterweights', difficulty: 'hard', stat: 'might', difficultyValue: 16, narration: 'The machinery itself becomes the obstacle.', flavor: 'environment', environmentFeature: 'swinging counterweights' },
  ];

  seedTurn(db, MECHANICS_SHOWCASE_SESSION_ID, null, 'Short bridge prompt.', choices, null, null, null, null, null, null, null, 'low');
  seedTurn(db, MECHANICS_SHOWCASE_SESSION_ID, 'seed-s7-c1',
    'Pip times the jump while Zara steadies the spell. The brass teeth slow just enough for the party to land on the far platform, and a tiny silver bridge token clicks loose into Pip\'s hand.',
    choices, 'Time the jump while Zara steadies the spell', 'mischief', 1, 12, 4, 13, 'Zara steadies the moment.', 'medium',
    JSON.stringify([{ characterName: 'Pip Gearwise', itemName: 'Silver Bridge Token', type: 'added' }]), 'normal',
    { itemBonus: 1, helperBonus: 2, helperCharacterName: 'Zara Brightspell' });
  seedTurn(db, MECHANICS_SHOWCASE_SESSION_ID, 'seed-s7-c1',
    'Pip reads every moving gear, every blinking rune, every warning bell, and every line of Zara\'s hurried chalk notes while the Clockwork Bridge unfolds into a long sequence of platforms, rails, pressure plates, light lenses, brass teeth, suspended counterweights, whispering bridge-keeper instructions, and tiny safe footholds that must be crossed in exact order before the whole span resets itself with a ringing snap.',
    choices, 'Hook Mira\'s anchor rope to the gear rail', 'mischief', 1, 11, 4, 13, 'The rope catches cleanly.', 'medium',
    null, 'normal', { itemBonus: 1, choiceItemBonus: 2, choiceItemName: 'Anchor Rope', choiceItemOwnerName: 'Mira Ironleaf' });
  seedTurn(db, MECHANICS_SHOWCASE_SESSION_ID, 'seed-s7-c1',
    'Pip\'s checklist is approved.',
    choices, 'Charm the bridge keeper with Pip\'s checklist', 'mischief', 1, 10, 4, 12, 'The checklist does the talking.', 'medium',
    null, 'normal', { itemBonus: 1, characterBonus: 2, characterBonusLabel: 'social edge' });
}

if (process.argv[1]?.endsWith('seedMechanicsShowcase.ts')) {
  StateService.initialize();
  const db = new Database(path.resolve(getConfig().SQLITE_DB_PATH));
  seedMechanicsShowcase(db);
  db.close();
  console.log(`Seed complete: ${MECHANICS_SHOWCASE_SESSION_ID}`);
}
