/**
 * Seed script: creates 3 example sessions with pre-populated turns.
 * Idempotent - drops and recreates sessions each run.
 * Run from backend/: npx tsx src/scripts/seedSessions.ts
 */

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { ImageService } from '../services/imageService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database(path.join(__dirname, '..', '..', 'database.sqlite'));

// ── helpers ──────────────────────────────────────────────────────────────────

function seedChar(sessionId: string, id: string, name: string, cls: string, species: string, quirk: string, might: number, magic: number, mischief: number, hp: number, maxHp: number) {
  db.prepare('DELETE FROM inventory WHERE characterId = ?').run(id);
  db.prepare('DELETE FROM characters WHERE id = ?').run(id);
  const avatarUrl = ImageService.generateInitialsSvg(name, sessionId);
  db.prepare(`INSERT INTO characters (id, sessionId, name, class, species, quirk, hp, max_hp, might, magic, mischief, status, avatarUrl)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`)
    .run(id, sessionId, name, cls, species, quirk, hp, maxHp, might, magic, mischief, avatarUrl);
}

function seedItem(characterId: string, name: string, description: string, healValue: number | null, statBonuses: string | null, consumable: number, transferable: number) {
  db.prepare(`INSERT INTO inventory (characterId, itemId, name, description, healValue, statBonuses, consumable, transferable)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(characterId, Math.random().toString(36).slice(2), name, description, healValue, statBonuses, consumable, transferable);
}

function seedTurn(sessionId: string, characterId: string | null, narration: string, choices: { label: string; difficulty: string; stat: string }[], actionAttempt: string | null, actionStat: string | null, actionSuccess: number | null, actionRoll: number | null, actionStatBonus: number | null, turnType: string = 'normal', imageUrl: string | null = null) {
  const info = db.prepare(`INSERT INTO turn_history (sessionId, characterId, narration, imagePrompt, imageSuggested, imageUrl, actionAttempt, actionStat, actionSuccess, actionRoll, actionStatBonus, turnType)
    VALUES (?, ?, ?, NULL, 0, ?, ?, ?, ?, ?, ?, ?)`)
    .run(sessionId, characterId, narration, imageUrl, actionAttempt, actionStat, actionSuccess, actionRoll, actionStatBonus, turnType);
  const turnId = info.lastInsertRowid;
  for (const c of choices) {
    db.prepare(`INSERT INTO turn_choices (turnId, label, difficulty, stat) VALUES (?, ?, ?, ?)`)
      .run(turnId, c.label, c.difficulty, c.stat);
  }
}

function deleteSession(id: string) {
  db.prepare('DELETE FROM turn_choices WHERE turnId IN (SELECT id FROM turn_history WHERE sessionId = ?)').run(id);
  db.prepare('DELETE FROM turn_history WHERE sessionId = ?').run(id);
  db.prepare('DELETE FROM inventory WHERE characterId IN (SELECT id FROM characters WHERE sessionId = ?)').run(id);
  db.prepare('DELETE FROM characters WHERE sessionId = ?').run(id);
  db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
}

const CHOICES_COMBAT = [
  { label: 'Strike with your weapon', difficulty: 'normal', stat: 'might' },
  { label: 'Cast a spell', difficulty: 'normal', stat: 'magic' },
  { label: 'Dodge and find an opening', difficulty: 'hard', stat: 'mischief' },
];
const CHOICES_EXPLORE = [
  { label: 'Search the area carefully', difficulty: 'easy', stat: 'mischief' },
  { label: 'Examine with magic', difficulty: 'normal', stat: 'magic' },
  { label: 'Force it open', difficulty: 'normal', stat: 'might' },
];
const CHOICES_SOCIAL = [
  { label: 'Persuade them', difficulty: 'normal', stat: 'mischief' },
  { label: 'Intimidate them', difficulty: 'normal', stat: 'might' },
  { label: 'Read their aura', difficulty: 'hard', stat: 'magic' },
];

// ── Session 1: The Goblin King's Lair ────────────────────────────────────────

const S1 = 'seed-session-1';
deleteSession(S1);
db.prepare(`INSERT INTO sessions (id, scene, sceneId, displayName, turn, activeCharacterId, tone, difficulty, savingsMode, useLocalAI, interventionUsed, storySummary)
  VALUES (?, 'The Goblin King Caverns', 'cave-1', 'The Goblin King Lair', 8, 'seed-s1-c2', 'thrilling adventure', 'normal', 0, 0, 0, ?)`)
  .run(S1, 'The party delved into the goblin caves seeking a stolen artifact. They fought through waves of goblin sentries, discovered a map to the throne room, and now stand before the Goblin King himself.');

seedChar(S1, 'seed-s1-c1', 'Barnabas Strongarm', 'Fighter', 'Dwarf', 'Talks to his axe like it is a person', 5, 1, 1, 7, 10);
seedChar(S1, 'seed-s1-c2', 'Zara the Nimble', 'Rogue', 'Halfling', 'Compulsively collects shiny objects', 1, 2, 4, 6, 10);
seedChar(S1, 'seed-s1-c3', 'Eldwin Spark', 'Mage', 'Elf', 'Speaks only in riddles when nervous', 1, 5, 1, 5, 10);
seedChar(S1, 'seed-s1-c4', 'Mira the Bold', 'Cleric', 'Human', 'Blesses everything she touches', 2, 4, 1, 8, 10);

seedItem('seed-s1-c4', 'Healing Potion', 'Restores 4 HP to the target', 4, null, 1, 1);
seedItem('seed-s1-c3', 'Arcane Focus', 'Boosts spell power', null, JSON.stringify({ magic: 2 }), 0, 0);
seedItem('seed-s1-c1', 'Battle Axe +1', 'A well-balanced axe', null, JSON.stringify({ might: 1 }), 0, 0);

seedTurn(S1, null, 'Your party descends into the damp, torchlit tunnels of the goblin warrens. Goblin sentries chitter in the shadows ahead. The smell of old bones and stolen treasure hangs in the air.', CHOICES_COMBAT, null, null, null, null, null);
seedTurn(S1, 'seed-s1-c1', 'Barnabas charges the nearest sentry with a bellowing warcry. His axe connects solidly and the goblin goes flying. Two more leap from the shadows!', CHOICES_COMBAT, 'Strike with your weapon', 'might', 1, 14, 5);
seedTurn(S1, 'seed-s1-c2', 'Zara darts between the goblins with supernatural speed, filching a shiny brass key from a guard while tripping another. The goblins are furious.', CHOICES_EXPLORE, 'Dodge and find an opening', 'mischief', 1, 17, 4);
seedTurn(S1, 'seed-s1-c3', 'Eldwin conjures a blinding flash that staggers the remaining guards. "Why did the mage cross the cave?" he mutters. "Because it was lit!" The path ahead is clear.', CHOICES_EXPLORE, 'Cast a spell', 'magic', 1, 16, 5);
seedTurn(S1, 'seed-s1-c4', 'Mira touches the ancient door and it swings open with a holy glow. Beyond lies a treasure room and a map showing the throne room - right above you.', CHOICES_SOCIAL, 'Examine with magic', 'magic', 1, 13, 4);
seedTurn(S1, 'seed-s1-c1', 'The Goblin King roars from his throne of stolen loot. "Intrudersss! KILL THEM!" He hurls a jagged crown like a disc weapon. Barnabas barely ducks in time.', CHOICES_COMBAT, 'Search the area carefully', 'mischief', 0, 4, 1, 'normal', null);
seedTurn(S1, 'seed-s1-c2', 'Zara spots a hidden lever behind the throne - if she can reach it, the cage trap above the king might spring. The king is distracted by Barnabas.', CHOICES_COMBAT, 'Search the area carefully', 'mischief', 1, 19, 4);

// ── Session 2: The Dragon's Peak (includes intervention + sanctuary) ──────────

const S2 = 'seed-session-2';
deleteSession(S2);
db.prepare(`INSERT INTO sessions (id, scene, sceneId, displayName, turn, activeCharacterId, tone, difficulty, savingsMode, useLocalAI, interventionUsed, storySummary)
  VALUES (?, 'The Dragon Peak Summit', 'peak-3', 'Dragon Peak', 10, 'seed-s2-c1', 'epic and dangerous', 'hard', 0, 0, 1, ?)`)
  .run(S2, 'The party climbed the treacherous Dragon Peak to retrieve a stolen dragon egg. They survived an ambush by cultists, fell off a cliff only to be saved by a mysterious dragon, woke in a mountain shelter, and now face the final cultist stronghold.');

seedChar(S2, 'seed-s2-c1', 'Vex the Wanderer', 'Rogue', 'Tiefling', 'Leaves a coin wherever they go as a calling card', 2, 2, 5, 5, 10);
seedChar(S2, 'seed-s2-c2', 'Solara Brightblade', 'Paladin', 'Half-Elf', 'Sings battle hymns slightly off-key', 4, 2, 1, 8, 10);
seedChar(S2, 'seed-s2-c3', 'Grimble', 'Wizard', 'Gnome', 'Cannot stop inventing gadgets at the worst moments', 1, 5, 1, 6, 10);
seedChar(S2, 'seed-s2-c4', 'The Unnamed One', 'Barbarian', 'Half-Orc', 'Claims to have no name but answers to anything', 5, 1, 1, 9, 10);

seedItem('seed-s2-c2', 'Holy Water Flask', 'Deals 5 extra damage to corrupted foes', 5, null, 1, 1);
seedItem('seed-s2-c3', 'Experimental Smoke Bomb', 'Creates obscuring smoke', null, JSON.stringify({ mischief: 2 }), 1, 1);

seedTurn(S2, null, 'The summit of Dragon Peak looms above the clouds. The stolen egg pulses with amber light somewhere above. Cultists in obsidian armor guard the narrow path ahead.', CHOICES_COMBAT, null, null, null, null, null);
seedTurn(S2, 'seed-s2-c4', 'The Unnamed One launches into a fury, hurling cultists off the path like ragdolls. The mountain shakes with each strike. "NAME ME AFTER THIS BATTLE!" they roar.', CHOICES_COMBAT, 'Strike with your weapon', 'might', 1, 18, 5);
seedTurn(S2, 'seed-s2-c3', 'Grimble triggers his latest gadget - a grappling claw - and it malfunctions spectacularly, launching him off the cliff edge. Everyone watches in horror.', CHOICES_COMBAT, 'Search the area carefully', 'mischief', 0, 2, 1, 'normal', null);
seedTurn(S2, 'seed-s2-c1', 'Vex tries to grab Grimble but both plummet. Solara and The Unnamed One are now alone facing the cultist high priest, who calls down lightning. Both are struck down.', CHOICES_COMBAT, 'Dodge and find an opening', 'mischief', 0, 3, 2, 'normal', null);

// Intervention turn - dragon rescue
seedTurn(S2, null, 'From the storm clouds above, an ancient dragon with scales like burnished copper erupts with a thunderous roar! It snatches the falling party members mid-air and deposits them back on the path, breathing a warm golden flame that stabilizes them. "Not yet, little ones," it rumbles. "The egg must be returned."', [
  { label: 'Thank the dragon and ask for guidance', difficulty: 'easy', stat: 'mischief' },
  { label: 'Rally to fight the high priest', difficulty: 'hard', stat: 'might' },
  { label: 'Use the chaos to slip past', difficulty: 'normal', stat: 'mischief' },
], null, null, null, null, null, 'intervention', '/api/images/intervention_dragon.png');

seedTurn(S2, 'seed-s2-c1', 'Vex uses the dragon distraction to slip behind the high priest and drive a blade into the gap in his armor. The priest staggers - but calls for his elite guard.', CHOICES_COMBAT, 'Dodge and find an opening', 'mischief', 1, 16, 5);
seedTurn(S2, 'seed-s2-c2', 'Solara battles the elite guard heroically but takes a vicious hit. With a final desperate swing she shatters the guard captain\'s shield. Both sides are exhausted and the party is overwhelmed again.', CHOICES_COMBAT, 'Strike with your weapon', 'might', 0, 5, 4, 'normal', null);

// Sanctuary turn
seedTurn(S2, null, 'The party wakes in a warm stone alcove carved into the mountainside - a hermit\'s shelter, long abandoned. Healing herbs hang from the ceiling and a small fire still burns. Outside, the storm howls. Someone bandaged your wounds while you slept. On the wall, scratched in common: "Courage returns with rest." Each of you feels the ache of battle but also the slow return of strength.', [
  { label: 'Search the shelter for supplies', difficulty: 'easy', stat: 'mischief' },
  { label: 'Plan the next assault', difficulty: 'easy', stat: 'magic' },
  { label: 'Head back up immediately', difficulty: 'hard', stat: 'might' },
], null, null, null, null, null, 'sanctuary', '/api/images/sanctuary_light.png');

// ── Session 3: The Merchant's Mystery ────────────────────────────────────────

const S3 = 'seed-session-3';
deleteSession(S3);
db.prepare(`INSERT INTO sessions (id, scene, sceneId, displayName, turn, activeCharacterId, tone, difficulty, savingsMode, useLocalAI, interventionUsed, storySummary)
  VALUES (?, 'The Whispering Market', 'market-2', 'The Merchant Mystery', 6, 'seed-s3-c2', 'mysterious and intriguing', 'easy', 0, 0, 0, ?)`)
  .run(S3, 'The party was hired to find a missing merchant\'s shipment. They discovered the cargo was actually a locked chest containing a cursed music box. The local thieves\' guild is also searching for it and may be watching.');

seedChar(S3, 'seed-s3-c1', 'Pipwick', 'Bard', 'Gnome', 'Turns every conversation into a song', 1, 2, 4, 7, 10);
seedChar(S3, 'seed-s3-c2', 'Thalia Stone', 'Ranger', 'Human', 'Has a pet crow named "Taxes"', 3, 1, 3, 8, 10);
seedChar(S3, 'seed-s3-c3', 'Brother Oswin', 'Cleric', 'Human', 'Apologizes to every creature before attacking it', 2, 4, 1, 9, 10);
seedChar(S3, 'seed-s3-c4', 'Mirela Voss', 'Sorcerer', 'Tiefling', 'Sparks fly from her hair when she lies', 1, 5, 1, 7, 10);

seedItem('seed-s3-c3', 'Healing Salve', 'Restores 3 HP when applied', 3, null, 1, 1);
seedItem('seed-s3-c1', 'Lute of Distraction', 'Creates minor illusions', null, JSON.stringify({ mischief: 1 }), 0, 0);

seedTurn(S3, null, 'The Whispering Market is alive with haggling merchants and suspicious glances. You have a tip that the missing shipment passed through here three days ago. The merchant\'s contact - a nervous man named Fil - is supposed to meet you at the spice stall.', CHOICES_SOCIAL, null, null, null, null, null);
seedTurn(S3, 'seed-s3-c1', 'Pipwick plays a cheerful tune near the spice stall and Fil visibly relaxes. He whispers that the chest was taken by someone in a red cloak - and he saw the same person at the dockside warehouse.', CHOICES_EXPLORE, 'Persuade them', 'mischief', 1, 15, 4);
seedTurn(S3, 'seed-s3-c2', 'Thalia sends Taxes (her crow) ahead to scout the warehouse. The bird returns with a torn piece of red cloth and - oddly - humming. The music box is in there.', CHOICES_EXPLORE, 'Search the area carefully', 'mischief', 1, 12, 3);
seedTurn(S3, 'seed-s3-c3', 'Brother Oswin examines the cloth and senses a dark enchantment. "Sorry in advance," he murmurs to the cursed fabric before casting a ward. The curse partially lifts - the box is somewhere on the upper floor.', CHOICES_SOCIAL, 'Examine with magic', 'magic', 1, 14, 4);
seedTurn(S3, 'seed-s3-c4', 'Mirela attempts to unlock the warehouse side door with a spell but a hidden glyph triggers an alarm. Sparks fly from her hair - she was NOT lying about the door being unlocked. Guards converge.', CHOICES_COMBAT, 'Cast a spell', 'magic', 0, 7, 5, 'normal', null);
seedTurn(S3, 'seed-s3-c2', 'Thalia notches an arrow and shoots out the lantern above the guards, plunging the alley into darkness. The party has seconds to decide - fight, flee, or find another way in.', CHOICES_COMBAT, 'Search the area carefully', 'mischief', 1, 16, 3);

// Update session active characters
db.prepare('UPDATE sessions SET activeCharacterId = ? WHERE id = ?').run('seed-s1-c2', S1);
db.prepare('UPDATE sessions SET activeCharacterId = ? WHERE id = ?').run('seed-s2-c1', S2);
db.prepare('UPDATE sessions SET activeCharacterId = ? WHERE id = ?').run('seed-s3-c2', S3);

console.log('Seed complete:');
console.log(`  Session 1 (${S1}): The Goblin King's Lair - 4 chars, 7 turns`);
console.log(`  Session 2 (${S2}): Dragon's Peak - 4 chars, 10 turns (intervention + sanctuary)`);
console.log(`  Session 3 (${S3}): The Merchant's Mystery - 4 chars, 6 turns`);
