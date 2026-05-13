// Session 2: Dragon's Peak - a hard-difficulty mountain climb ending in a climactic cultist showdown.
// Showcases: intervention turn (copper dragon rescue), sanctuary turn (mountain hermit shelter), interventionUsed + rescues_used flags set.
import type { Database as DB } from 'libsql';
import { deleteSession, seedChar, seedItem, seedTurn, CHOICES_COMBAT } from './seedHelpers.js';

export const SESSION_ID = 'seed-session-2';

export function seed(db: DB): void {
  deleteSession(db, SESSION_ID);
  db.prepare(`INSERT INTO sessions (id, scene, sceneId, displayName, turn, activeCharacterId, tone, difficulty, gameMode, savingsMode, useLocalAI, interventionUsed, rescues_used, game_over, storySummary, dm_prep)
    VALUES (?, 'The Dragon Peak Summit', 'peak-3', 'Dragon Peak', 10, 'seed-s2-c1', 'epic and dangerous', 'hard', 'balanced', 0, 0, 1, 1, 0, ?, NULL)`)
    .run(SESSION_ID, 'The party climbed the treacherous Dragon Peak to retrieve a stolen dragon egg. They survived an ambush by cultists, fell off a cliff only to be saved by a mysterious dragon, woke in a mountain shelter, and now face the final cultist stronghold.');

  seedChar(db, SESSION_ID, 'seed-s2-c1', 'Vex the Wanderer', 'Rogue', 'Tiefling', 'Leaves a coin wherever they go as a calling card', 2, 2, 5, 5, 10);
  seedChar(db, SESSION_ID, 'seed-s2-c2', 'Solara Brightblade', 'Paladin', 'Half-Elf', 'Sings battle hymns slightly off-key', 4, 2, 1, 8, 10);
  seedChar(db, SESSION_ID, 'seed-s2-c3', 'Grimble', 'Wizard', 'Gnome', 'Cannot stop inventing gadgets at the worst moments', 1, 5, 1, 6, 10);
  seedChar(db, SESSION_ID, 'seed-s2-c4', 'The Unnamed One', 'Barbarian', 'Half-Orc', 'Claims to have no name but answers to anything', 5, 1, 1, 9, 10);

  seedItem(db, 'seed-s2-c2', 's2-i1', '💧 Holy Water Flask', 'Deals 5 extra damage to corrupted foes', 5, null, 1, 1);
  seedItem(db, 'seed-s2-c3', 's2-i2', '💨 Experimental Smoke Bomb', 'Creates obscuring smoke', null, JSON.stringify({ mischief: 2 }), 1, 1);

  seedTurn(db, SESSION_ID, null, 'The summit of Dragon Peak looms above the clouds. The stolen egg pulses with amber light somewhere above. Cultists in obsidian armor guard the narrow path ahead.', CHOICES_COMBAT, null, null, null, null, null);
  seedTurn(db, SESSION_ID, 'seed-s2-c4', 'The Unnamed One launches into a fury, hurling cultists off the path like ragdolls. The mountain shakes with each strike. "NAME ME AFTER THIS BATTLE!" they roar.', CHOICES_COMBAT, 'Strike with your weapon', 'might', 1, 18, 5, 'normal', null, 12);
  seedTurn(db, SESSION_ID, 'seed-s2-c3', 'Grimble triggers his latest gadget - a grappling claw - and it malfunctions spectacularly, launching him off the cliff edge. Everyone watches in horror.', CHOICES_COMBAT, 'Search the area carefully', 'mischief', 0, 2, 1, 'normal', null, 8);
  seedTurn(db, SESSION_ID, 'seed-s2-c1', 'Vex tries to grab Grimble but both plummet. Solara and The Unnamed One are now alone facing the cultist high priest, who calls down lightning. Both are struck down.', CHOICES_COMBAT, 'Dodge and find an opening', 'mischief', 0, 3, 2, 'normal', null, 15);

  seedTurn(db, SESSION_ID, null, 'From the storm clouds above, an ancient dragon with scales like burnished copper erupts with a thunderous roar! It snatches the falling party members mid-air and deposits them back on the path, breathing a warm golden flame that stabilizes them. "Not yet, little ones," it rumbles. "The egg must be returned."', [
    { label: 'Thank the dragon and ask for guidance', difficulty: 'easy', stat: 'mischief', difficultyValue: 7 },
    { label: 'Rally to fight the high priest', difficulty: 'hard', stat: 'might', difficultyValue: 16 },
    { label: 'Use the chaos to slip past', difficulty: 'normal', stat: 'mischief', difficultyValue: 11 },
  ], null, null, null, null, null, 'intervention', '/images/intervention_dragon.png');

  seedTurn(db, SESSION_ID, 'seed-s2-c1', 'Vex uses the dragon distraction to slip behind the high priest and drive a blade into the gap in his armor. The priest staggers - but calls for his elite guard.', CHOICES_COMBAT, 'Dodge and find an opening', 'mischief', 1, 16, 5, 'normal', null, 15);
  seedTurn(db, SESSION_ID, 'seed-s2-c2', 'Solara battles the elite guard heroically but takes a vicious hit. With a final desperate swing she shatters the guard captain\'s shield. Both sides are exhausted and the party is overwhelmed again.', CHOICES_COMBAT, 'Strike with your weapon', 'might', 0, 5, 4, 'normal', null, 12, '🎲 A heavy blow, but your defense falters.');

  seedTurn(db, SESSION_ID, null, 'The party wakes in a warm stone alcove carved into the mountainside - a hermit\'s shelter, long abandoned. Healing herbs hang from the ceiling and a small fire still burns. Outside, the storm howls. Someone bandaged your wounds while you slept. On the wall, scratched in common: "Courage returns with rest." Each of you feels the ache of battle but also the slow return of strength.', [
    { label: 'Search the shelter for supplies', difficulty: 'easy', stat: 'mischief', difficultyValue: 7 },
    { label: 'Plan the next assault', difficulty: 'easy', stat: 'magic', difficultyValue: 6 },
    { label: 'Head back up immediately', difficulty: 'hard', stat: 'might', difficultyValue: 16 },
  ], null, null, null, null, null, 'sanctuary', '/images/sanctuary_light.png');
}
