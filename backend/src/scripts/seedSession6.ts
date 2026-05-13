// Session 6: The Tomb of Endless Dark - a doomed campaign that ended in a total party wipe.
// Showcases: game_over=1, all characters in 'downed' status, intervention turn mid-session, hpChanges on multiple turns, high sustained tension.
import type { Database as DB } from 'libsql';
import { deleteSession, seedChar, seedTurn } from './seedHelpers.js';

export const SESSION_ID = 'seed-session-6';

const CHOICES_TOMB = [
  { label: 'Press forward into the dark', difficulty: 'normal', stat: 'might', difficultyValue: 12 },
  { label: 'Detect magical traps', difficulty: 'normal', stat: 'magic', difficultyValue: 11 },
  { label: 'Scout ahead in the shadows', difficulty: 'hard', stat: 'mischief', difficultyValue: 14 },
];

const CHOICES_LICH = [
  { label: 'Strike the Lich Lord directly', difficulty: 'hard', stat: 'might', difficultyValue: 16 },
  { label: 'Shatter his phylactery with magic', difficulty: 'hard', stat: 'magic', difficultyValue: 16 },
  { label: 'Steal the phylactery and run', difficulty: 'hard', stat: 'mischief', difficultyValue: 15 },
];

export function seed(db: DB): void {
  deleteSession(db, SESSION_ID);
  db.prepare(`INSERT INTO sessions (id, scene, sceneId, displayName, turn, activeCharacterId, tone, difficulty, gameMode, savingsMode, useLocalAI, interventionUsed, rescues_used, game_over, storySummary, dm_prep)
    VALUES (?, 'The Sunken Sanctum - Final Chamber', 'tomb-final', 'The Tomb of Endless Dark', 14, 'seed-s6-c1', 'desperate and doomed', 'hard', 'balanced', 0, 0, 1, 1, 1, ?, NULL)`)
    .run(SESSION_ID, 'The party ventured into the ancient Tomb of Endless Dark seeking a legendary relic. They survived traps, undead hordes, and an Arcane Wraith that nearly killed them all - saved only by a dragon intervention. Battered and desperate they pressed on into the final sanctum. The Lich Lord was waiting. He was ready. They were not.');

  seedChar(db, SESSION_ID, 'seed-s6-c1', 'Aldric the Steadfast', 'Fighter', 'Human', 'Never retreats - not even once', 5, 1, 1, 0, 10, 'downed');
  seedChar(db, SESSION_ID, 'seed-s6-c2', 'Yenna Ashveil', 'Witch', 'Half-Elf', 'Whispers apologies to her spells before casting them', 1, 5, 1, 0, 10, 'downed');
  seedChar(db, SESSION_ID, 'seed-s6-c3', 'Rutger', 'Barbarian', 'Human', 'Laughs loudest when things are most dire', 5, 1, 2, 0, 12, 'downed');
  seedChar(db, SESSION_ID, 'seed-s6-c4', 'Pip Quickfingers', 'Rogue', 'Halfling', 'Steals things reflexively, even from friends', 1, 2, 5, 0, 8, 'downed');

  seedTurn(db, SESSION_ID, null, 'The Tomb of Endless Dark swallows all light. Somewhere ahead the relic pulses with a cold blue glow. The air smells of centuries of rot and old magic. Something ancient knows you are here.', CHOICES_TOMB, null, null, null, null, null, 'normal', null, null, null, 'medium', null);
  seedTurn(db, SESSION_ID, 'seed-s6-c1', 'Aldric shoulders open the first sealed door, his jaw set. Beyond: a corridor lined with standing sarcophagi. Twenty. Maybe more. Their stone lids begin to tremble.', CHOICES_TOMB, 'Press forward into the dark', 'might', 1, 15, 5, 'normal', null, 12, null, 'medium', null);
  seedTurn(db, SESSION_ID, 'seed-s6-c2', 'Yenna whispers an apology to her detection spell and casts it wide. Three pressure plates revealed, two concealed pits - and something massive in the walls, waiting. "Sorry," she breathes. "Very sorry."', CHOICES_TOMB, 'Detect magical traps', 'magic', 1, 14, 5, 'normal', null, 11, null, 'medium', null);
  seedTurn(db, SESSION_ID, 'seed-s6-c3', 'The sarcophagi burst open. Rutger laughs the loudest laugh of his life and wades in with both fists. Skeletal warriors shatter against him. Twelve down. Eight remaining. He is still laughing.', CHOICES_TOMB, 'Press forward into the dark', 'might', 1, 19, 5, 'normal', null, 12, '🎲 Absolute carnage. The skeletons regret rising.', 'high', null);
  seedTurn(db, SESSION_ID, 'seed-s6-c4', 'Pip filches a glowing amulet from a skeletal captain mid-combat, purely by reflex. It hums with warmth. Then an Arcane Wraith materializes from the ceiling - and the warmth turns cold.', CHOICES_LICH, 'Scout ahead in the shadows', 'mischief', 1, 17, 5, 'normal', null, 14, null, 'high', null);
  seedTurn(db, SESSION_ID, 'seed-s6-c1', 'The Wraith passes through Aldric\'s armor like smoke. He staggers, 4 HP gone. But he grabs its ethereal form with iron will and slams it into the floor. For a moment it is solid. Just a moment.', CHOICES_LICH, 'Strike the Lich Lord directly', 'might', 0, 6, 5, 'normal', null, 16, '🎲 A desperate grab - not enough.', 'high', JSON.stringify([{ characterId: 'seed-s6-c1', characterName: 'Aldric the Steadfast', change: -4, newHp: 4, maxHp: 10 }]));
  seedTurn(db, SESSION_ID, 'seed-s6-c2', 'Yenna pours everything into a banishment hex. The Wraith shrieks and dissolves. She collapses to her knees, spent. The party stands in silence. Then: slow, deliberate clapping from the chamber ahead.', CHOICES_LICH, 'Shatter his phylactery with magic', 'magic', 1, 18, 5, 'normal', null, 16, '🎲 The spell lands. The Wraith unmakes itself screaming.', 'high', null);

  seedTurn(db, SESSION_ID, null, 'The Lich Lord\'s first strike drops the entire party to zero. From somewhere impossibly far above, a copper dragon\'s roar shakes dust from the ceiling. A beam of golden light threads down through cracked stone and touches each fallen hero. "Not here," the dragon\'s voice echoes through the rock. "Not like this." The party gasps back to 1 HP each. The Lich Lord tilts his skull with academic curiosity. "Fascinating. Try again."', [
    { label: 'Charge the Lich Lord while he is distracted', difficulty: 'hard', stat: 'might', difficultyValue: 16 },
    { label: 'Shatter the phylactery on the altar', difficulty: 'hard', stat: 'magic', difficultyValue: 17 },
    { label: 'Grab the relic and find an exit', difficulty: 'hard', stat: 'mischief', difficultyValue: 15 },
  ], null, null, null, null, null, 'intervention', '/images/intervention_dragon.png', null, null, 'high', null);

  seedTurn(db, SESSION_ID, 'seed-s6-c3', 'Rutger laughs one last time - quieter this time, almost fond - and charges the Lich Lord with everything he has. The blow lands. The phylactery cracks. One more hit and it shatters. The Lich Lord is not amused.', CHOICES_LICH, 'Charge the Lich Lord while he is distracted', 'might', 1, 17, 5, 'normal', null, 16, '🎲 The mightiest blow of his life. The crack spreads.', 'high', null);
  seedTurn(db, SESSION_ID, 'seed-s6-c4', 'Pip lunges for the phylactery - fingertips brush the cracked surface - but the Lich Lord\'s hand closes around his wrist. "Charming effort," the Lich says. Pip takes 5 damage and goes down.', CHOICES_LICH, 'Steal the phylactery and run', 'mischief', 0, 4, 5, 'normal', null, 15, '🎲 So close. The hand closes too fast.', 'high', JSON.stringify([{ characterId: 'seed-s6-c4', characterName: 'Pip Quickfingers', change: -5, newHp: 0, maxHp: 8 }]));
  seedTurn(db, SESSION_ID, 'seed-s6-c1', 'Aldric steps over Pip and plants himself between the Lich and the others. His sword arm shaking. His voice steady: "You will not have them." He charges. He is struck down before he reaches the throne.', CHOICES_LICH, 'Strike the Lich Lord directly', 'might', 0, 3, 5, 'normal', null, 16, '🎲 The bravest roll of a doomed hand.', 'high', JSON.stringify([{ characterId: 'seed-s6-c1', characterName: 'Aldric the Steadfast', change: -3, newHp: 0, maxHp: 10 }]));
  seedTurn(db, SESSION_ID, 'seed-s6-c2', 'Yenna and Rutger fight on alone. Yenna\'s last spell flickers out. Rutger\'s laughter stops. The phylactery holds. The Lich Lord dims the room with a gesture. When the light returns, the chamber is silent.', CHOICES_LICH, 'Shatter his phylactery with magic', 'magic', 0, 2, 5, 'normal', null, 17, '🎲 The magic dies in her hands. Nothing left.', 'high', JSON.stringify([
    { characterId: 'seed-s6-c2', characterName: 'Yenna Ashveil', change: -4, newHp: 0, maxHp: 10 },
    { characterId: 'seed-s6-c3', characterName: 'Rutger', change: -3, newHp: 0, maxHp: 12 },
  ]));

}
