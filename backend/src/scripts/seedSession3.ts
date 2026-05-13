// Session 3: The Merchant's Mystery - a social/exploration investigation in an urban market.
// Showcases: easy difficulty, cinematic game mode, mix of social and explore turns with no combat until the final turn.
import type { Database as DB } from 'libsql';
import { deleteSession, seedChar, seedItem, seedTurn, CHOICES_COMBAT, CHOICES_EXPLORE, CHOICES_SOCIAL } from './seedHelpers.js';

export const SESSION_ID = 'seed-session-3';

export function seed(db: DB): void {
  deleteSession(db, SESSION_ID);
  db.prepare(`INSERT INTO sessions (id, scene, sceneId, displayName, turn, activeCharacterId, tone, difficulty, gameMode, savingsMode, useLocalAI, interventionUsed, rescues_used, game_over, storySummary, dm_prep)
    VALUES (?, 'The Whispering Market', 'market-2', 'The Merchant Mystery', 6, 'seed-s3-c2', 'mysterious and intriguing', 'easy', 'cinematic', 0, 0, 0, 0, 0, ?, NULL)`)
    .run(SESSION_ID, 'The party was hired to find a missing merchant\'s shipment. They discovered the cargo was actually a locked chest containing a cursed music box. The local thieves\' guild is also searching for it and may be watching.');

  seedChar(db, SESSION_ID, 'seed-s3-c1', 'Pipwick', 'Bard', 'Gnome', 'Turns every conversation into a song', 1, 2, 4, 7, 10);
  seedChar(db, SESSION_ID, 'seed-s3-c2', 'Thalia Stone', 'Ranger', 'Human', 'Has a pet crow named "Taxes"', 3, 1, 3, 8, 10);
  seedChar(db, SESSION_ID, 'seed-s3-c3', 'Brother Oswin', 'Cleric', 'Human', 'Apologizes to every creature before attacking it', 2, 4, 1, 9, 10);
  seedChar(db, SESSION_ID, 'seed-s3-c4', 'Mirela Voss', 'Sorcerer', 'Tiefling', 'Sparks fly from her hair when she lies', 1, 5, 1, 7, 10);

  seedItem(db, 'seed-s3-c3', 's3-i1', '🩹 Healing Salve', 'Restores 3 HP when applied', 3, null, 1, 1);
  seedItem(db, 'seed-s3-c1', 's3-i2', '🎸 Lute of Distraction', 'Creates minor illusions', null, JSON.stringify({ mischief: 1 }), 0, 0);

  seedTurn(db, SESSION_ID, null, 'The Whispering Market is alive with haggling merchants and suspicious glances. You have a tip that the missing shipment passed through here three days ago. The merchant\'s contact - a nervous man named Fil - is supposed to meet you at the spice stall.', CHOICES_SOCIAL, null, null, null, null, null);
  seedTurn(db, SESSION_ID, 'seed-s3-c1', 'Pipwick plays a cheerful tune near the spice stall and Fil visibly relaxes. He whispers that the chest was taken by someone in a red cloak - and he saw the same person at the dockside warehouse.', CHOICES_EXPLORE, 'Persuade them', 'mischief', 1, 15, 4, 'normal', null, 11);
  seedTurn(db, SESSION_ID, 'seed-s3-c2', 'Thalia sends Taxes (her crow) ahead to scout the warehouse. The bird returns with a torn piece of red cloth and - oddly - humming. The music box is in there.', CHOICES_EXPLORE, 'Search the area carefully', 'mischief', 1, 12, 3, 'normal', null, 8);
  seedTurn(db, SESSION_ID, 'seed-s3-c3', 'Brother Oswin examines the cloth and senses a dark enchantment. "Sorry in advance," he murmurs to the cursed fabric before casting a ward. The curse partially lifts - the box is somewhere on the upper floor.', CHOICES_SOCIAL, 'Examine with magic', 'magic', 1, 14, 4, 'normal', null, 11);
  seedTurn(db, SESSION_ID, 'seed-s3-c4', 'Mirela attempts to unlock the warehouse side door with a spell but a hidden glyph triggers an alarm. Sparks fly from her hair - she was NOT lying about the door being unlocked. Guards converge.', CHOICES_COMBAT, 'Cast a spell', 'magic', 0, 7, 5, 'normal', null, 11);
  seedTurn(db, SESSION_ID, 'seed-s3-c2', 'Thalia notches an arrow and shoots out the lantern above the guards, plunging the alley into darkness. The party has seconds to decide - fight, flee, or find another way in.', CHOICES_COMBAT, 'Search the area carefully', 'mischief', 1, 16, 3, 'normal', null, 8, '🎲 Sharp eyes in the dark. The arrow flies true.');
}
