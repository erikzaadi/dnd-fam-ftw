// Session 4: ZUG-MA-GEDDON - a three-person party thrown into an endless arena.
// Showcases: zug-ma-geddon game mode, hard difficulty, pure combat with escalating waves, includes a failed action mid-session.
import type { Database as DB } from 'libsql';
import { deleteSession, seedChar, seedItem, seedTurn, CHOICES_COMBAT } from './seedHelpers.js';

export const SESSION_ID = 'seed-session-4';

export function seed(db: DB): void {
  deleteSession(db, SESSION_ID);
  db.prepare(`INSERT INTO sessions (id, scene, sceneId, displayName, turn, activeCharacterId, tone, difficulty, gameMode, savingsMode, useLocalAI, interventionUsed, rescues_used, game_over, storySummary, dm_prep)
    VALUES (?, 'The Bloodpit Arena', 'arena-1', 'ZUG-MA-GEDDON: The Endless Arena', 5, 'seed-s4-c2', 'pure chaos and carnage', 'hard', 'zug-ma-geddon', 0, 0, 0, 0, 0, ?, NULL)`)
    .run(SESSION_ID, 'You were thrown into the Bloodpit Arena by persons unknown. There is no escape. There is only combat. The crowd chants ZUG. ZUG. ZUG.');

  seedChar(db, SESSION_ID, 'seed-s4-c1', 'Krag Bonecrusher', 'Barbarian', 'Half-Orc', 'Cannot whisper - only screams', 6, 1, 1, 4, 12);
  seedChar(db, SESSION_ID, 'seed-s4-c2', 'Spark', 'Sorcerer', 'Tiefling', 'Accidentally sets things on fire when excited', 1, 6, 1, 5, 8);
  seedChar(db, SESSION_ID, 'seed-s4-c3', 'Dagmar Ironfist', 'Fighter', 'Dwarf', 'Headbutts doors instead of opening them', 5, 1, 2, 6, 10);

  seedItem(db, 'seed-s4-c1', 's4-i1', '🍖 Mystery Meat', 'Restores 3 HP (best not to ask what it is)', 3, null, 1, 1);
  seedItem(db, 'seed-s4-c2', 's4-i2', '⚡ Crackling Orb', 'Supercharges the next spell', null, JSON.stringify({ magic: 3 }), 0, 0);

  seedTurn(db, SESSION_ID, null, 'THE GATES CRASH OPEN. An armored troll the size of a house charges your position bellowing "ZUG ZUG ZUG". The crowd roars. Blood has not yet been spilled. This is about to change.', CHOICES_COMBAT, null, null, null, null, null);
  seedTurn(db, SESSION_ID, 'seed-s4-c1', 'Krag SCREAMS and charges headfirst into the troll. The collision shakes the arena floor. The troll stumbles. Krag is bleeding. The crowd loses their minds.', CHOICES_COMBAT, 'Strike with your weapon', 'might', 1, 18, 6, 'normal', null, 14);
  seedTurn(db, SESSION_ID, 'seed-s4-c2', 'Spark\'s hair ignites with excitement as three bolts of lightning explode from her fingertips. The troll is scorched black and FURIOUS. It swipes Spark off her feet for 3 damage.', CHOICES_COMBAT, 'Cast a spell', 'magic', 0, 5, 6, 'normal', null, 14);
  seedTurn(db, SESSION_ID, 'seed-s4-c3', 'Dagmar headbutts the troll\'s kneecap - cracks it. The troll falls to one knee. The entire arena is on its feet screaming. A second gate is already opening.', CHOICES_COMBAT, 'Strike with your weapon', 'might', 1, 15, 5, 'normal', null, 12);
  seedTurn(db, SESSION_ID, 'seed-s4-c1', 'The troll collapses. Gate two opens. An ogre with a giant net and a grin enters. Behind it: three more goblins riding armored wolves. The DM cackles.', CHOICES_COMBAT, 'Dodge and find an opening', 'mischief', 1, 19, 6, 'normal', null, 15, '🎲 Pure instinct. The crowd chants your name.');
}
