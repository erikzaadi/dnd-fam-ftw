// Session 7: Mechanics Showcase - a deterministic fixture for Playwright visual tests.
// Showcases: every choice flavor (combo, item, social, environment), roll breakdown display, long narration scroll, inventoryChanges, actionDetails bonuses.
// savingsMode=1 so no images are generated. Can be run standalone: npx tsx src/scripts/seedMechanicsShowcase.ts
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import Database, { type Database as DB } from 'libsql';
import { getConfig } from '../config/env.js';
import { StateService } from '../services/stateService.js';
import { deleteSession, seedChar, seedItem, seedTurn, type SeedChoice } from './seedHelpers.js';

dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '.env'), quiet: true });

export const MECHANICS_SHOWCASE_SESSION_ID = 'seed-session-7';
const LEGACY_SESSION_ID = 'seed-session-mechanics-showcase';

export function seed(db: DB): void {
  deleteSession(db, LEGACY_SESSION_ID);
  deleteSession(db, MECHANICS_SHOWCASE_SESSION_ID);
  db.prepare(`INSERT INTO sessions (id, scene, sceneId, displayName, turn, activeCharacterId, tone, difficulty, gameMode, savingsMode, useLocalAI, interventionUsed, rescues_used, game_over, storySummary, dm_prep)
    VALUES (?, 'The Clockwork Bridge', 'mechanics-showcase', 'Mechanics Showcase', 4, 'seed-s7-c1', 'clear test fixture', 'normal', 'fast', 1, 0, 0, 0, 0, ?, NULL)`)
    .run(MECHANICS_SHOWCASE_SESSION_ID, 'A deterministic fixture for Playwright visual assertions around choice flavors, roll breakdowns, and narration scroll behavior.');

  seedChar(db, MECHANICS_SHOWCASE_SESSION_ID, 'seed-s7-c1', 'Pip Gearwise', 'Rogue', 'Halfling', 'Keeps a checklist for every risky idea', 1, 2, 4, 8, 10);
  seedChar(db, MECHANICS_SHOWCASE_SESSION_ID, 'seed-s7-c2', 'Zara Brightspell', 'Mage', 'Elf', 'Times every spell with a wink', 1, 5, 1, 7, 10);
  seedChar(db, MECHANICS_SHOWCASE_SESSION_ID, 'seed-s7-c3', 'Mira Ironleaf', 'Ranger', 'Human', 'Names every useful knot', 3, 1, 3, 9, 10);
  seedChar(db, MECHANICS_SHOWCASE_SESSION_ID, 'seed-s7-c4', 'Oswin Bell', 'Cleric', 'Human', 'Apologizes before ringing any bell', 2, 4, 1, 9, 10);

  seedItem(db, 'seed-s7-c1', 's7-brass-compass', '🧭 Brass Compass', 'Points toward hidden mechanisms', null, JSON.stringify({ mischief: 1 }), 0, 0);
  seedItem(db, 'seed-s7-c2', 's7-moon-lens', '🌙 Moon Lens', 'Focuses pale light onto invisible marks', null, JSON.stringify({ magic: 1 }), 0, 0);
  seedItem(db, 'seed-s7-c3', 's7-anchor-rope', '🪢 Anchor Rope', 'Locks onto stone when thrown carefully', null, null, 0, 1);

  const choices: SeedChoice[] = [
    { label: 'Time the jump while Zara steadies the spell', difficulty: 'normal', stat: 'mischief', difficultyValue: 13, narration: 'A clean team-up can cross the moving gears.', flavor: 'combo', helperCharacterName: 'Zara Brightspell' },
    { label: 'Hook Mira\'s anchor rope to the gear rail', difficulty: 'normal', stat: 'mischief', difficultyValue: 13, narration: 'Marked gear can make the crossing safer.', flavor: 'item', itemOwnerName: 'Mira Ironleaf', itemName: '🪢 Anchor Rope' },
    { label: 'Charm the bridge keeper with Pip\'s checklist', difficulty: 'normal', stat: 'mischief', difficultyValue: 12, narration: 'A social read can turn suspicion into help.', flavor: 'social' },
    { label: 'Duck under the swinging counterweights', difficulty: 'hard', stat: 'might', difficultyValue: 16, narration: 'The machinery itself becomes the obstacle.', flavor: 'environment', environmentFeature: 'swinging counterweights' },
  ];

  seedTurn(db, MECHANICS_SHOWCASE_SESSION_ID, null, 'Short bridge prompt.', choices, null, null, null, null, null, 'normal', null, null, null, 'low');
  seedTurn(db, MECHANICS_SHOWCASE_SESSION_ID, 'seed-s7-c1',
    'Pip times the jump while Zara steadies the spell. The brass teeth slow just enough for the party to land on the far platform, and a tiny silver bridge token clicks loose into Pip\'s hand.',
    choices, 'Time the jump while Zara steadies the spell', 'mischief', 1, 12, 4, 'normal', null, 13, 'Zara steadies the moment.', 'medium',
    null, JSON.stringify([{ characterName: 'Pip Gearwise', itemName: 'Silver Bridge Token', type: 'added' }]), 'normal',
    { itemBonus: 1, helperBonus: 2, helperCharacterName: 'Zara Brightspell' });
  seedTurn(db, MECHANICS_SHOWCASE_SESSION_ID, 'seed-s7-c1',
    'Pip reads every moving gear, every blinking rune, every warning bell, and every line of Zara\'s hurried chalk notes while the Clockwork Bridge unfolds into a long sequence of platforms, rails, pressure plates, light lenses, brass teeth, suspended counterweights, whispering bridge-keeper instructions, and tiny safe footholds that must be crossed in exact order before the whole span resets itself with a ringing snap.',
    choices, 'Hook Mira\'s anchor rope to the gear rail', 'mischief', 1, 11, 4, 'normal', null, 13, 'The rope catches cleanly.', 'medium',
    null, null, 'normal', { itemBonus: 1, choiceItemBonus: 2, choiceItemName: '🪢 Anchor Rope', choiceItemOwnerName: 'Mira Ironleaf' });
  seedTurn(db, MECHANICS_SHOWCASE_SESSION_ID, 'seed-s7-c1',
    'Pip\'s checklist is approved.',
    choices, 'Charm the bridge keeper with Pip\'s checklist', 'mischief', 1, 10, 4, 'normal', null, 12, 'The checklist does the talking.', 'medium',
    null, null, 'normal', { itemBonus: 1, characterBonus: 2, characterBonusLabel: 'social edge' });
}

// Alias for backward compatibility with any direct callers
export const seedMechanicsShowcase = seed;

if (process.argv[1]?.endsWith('seedMechanicsShowcase.ts')) {
  StateService.initialize();
  const db = new Database(path.resolve(getConfig().SQLITE_DB_PATH));
  seed(db);
  db.close();
  console.log(`Seed complete: ${MECHANICS_SHOWCASE_SESSION_ID}`);
}
