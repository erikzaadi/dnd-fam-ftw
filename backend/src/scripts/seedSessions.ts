/**
 * Seed script: creates 3 example sessions with pre-populated turns.
 * Idempotent - drops and recreates sessions each run.
 * Run from backend/: npx tsx src/scripts/seedSessions.ts
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'libsql';
import { getConfig } from '../config/env.js';
import { StateService } from '../services/stateService.js';
import { ImageService } from '../services/imageService.js';

dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '.env'), quiet: true });

// Ensure DB exists and migrations have run before seeding
StateService.initialize();

const dbPath = path.resolve(getConfig().SQLITE_DB_PATH);
const db = new Database(dbPath);

// ── helpers ──────────────────────────────────────────────────────────────────

function seedChar(sessionId: string, id: string, name: string, cls: string, species: string, quirk: string, might: number, magic: number, mischief: number, hp: number, maxHp: number, status: 'active' | 'downed' = 'active') {
  db.prepare('DELETE FROM inventory WHERE characterId = ?').run(id);
  db.prepare('DELETE FROM characters WHERE id = ?').run(id);
  const avatarUrl = ImageService.generateInitialsSvg(name, sessionId);
  db.prepare(`INSERT INTO characters (id, sessionId, name, class, species, quirk, hp, max_hp, might, magic, mischief, status, avatarUrl)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, sessionId, name, cls, species, quirk, hp, maxHp, might, magic, mischief, status, avatarUrl);
}

function seedItem(characterId: string, name: string, description: string, healValue: number | null, statBonuses: string | null, consumable: number, transferable: number) {
  db.prepare(`INSERT INTO inventory (characterId, itemId, name, description, healValue, statBonuses, consumable, transferable)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(characterId, Math.random().toString(36).slice(2), name, description, healValue, statBonuses, consumable, transferable);
}

function seedTurn(sessionId: string, characterId: string | null, narration: string, choices: { label: string; difficulty: string; stat: string; difficultyValue?: number; narration?: string }[], actionAttempt: string | null, actionStat: string | null, actionSuccess: number | null, actionRoll: number | null, actionStatBonus: number | null, turnType: string = 'normal', imageUrl: string | null = null, actionDifficultyTarget: number | null = null, rollNarration: string | null = null, currentTensionLevel: string | null = null, hpChanges: string | null = null, inventoryChanges: string | null = null, actionImpact: string | null = null) {
  const info = db.prepare(`INSERT INTO turn_history (sessionId, characterId, narration, rollNarration, imagePrompt, imageSuggested, imageUrl, actionAttempt, actionStat, actionSuccess, actionRoll, actionStatBonus, actionImpact, actionDifficultyTarget, turnType, currentTensionLevel, hpChanges, inventoryChanges)
    VALUES (?, ?, ?, ?, NULL, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(sessionId, characterId, narration, rollNarration, imageUrl, actionAttempt, actionStat, actionSuccess, actionRoll, actionStatBonus, actionImpact, actionDifficultyTarget, turnType, currentTensionLevel, hpChanges, inventoryChanges);
  const turnId = info.lastInsertRowid;
  for (const c of choices) {
    db.prepare(`INSERT INTO turn_choices (turnId, label, difficulty, stat, difficultyValue, narration) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(turnId, c.label, c.difficulty, c.stat, c.difficultyValue ?? null, c.narration ?? null);
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
  { label: 'Strike with your weapon', difficulty: 'normal', stat: 'might', difficultyValue: 12 },
  { label: 'Cast a spell', difficulty: 'normal', stat: 'magic', difficultyValue: 11 },
  { label: 'Dodge and find an opening', difficulty: 'hard', stat: 'mischief', difficultyValue: 15 },
];
const CHOICES_EXPLORE = [
  { label: 'Search the area carefully', difficulty: 'easy', stat: 'mischief', difficultyValue: 8 },
  { label: 'Examine with magic', difficulty: 'normal', stat: 'magic', difficultyValue: 11 },
  { label: 'Force it open', difficulty: 'normal', stat: 'might', difficultyValue: 13 },
];
const CHOICES_SOCIAL = [
  { label: 'Persuade them', difficulty: 'normal', stat: 'mischief', difficultyValue: 11 },
  { label: 'Intimidate them', difficulty: 'normal', stat: 'might', difficultyValue: 12 },
  { label: 'Read their aura', difficulty: 'hard', stat: 'magic', difficultyValue: 14 },
];

// ── Session 1: The Goblin King's Lair ────────────────────────────────────────

const S1 = 'seed-session-1';
deleteSession(S1);
db.prepare(`INSERT INTO sessions (id, scene, sceneId, displayName, turn, activeCharacterId, tone, difficulty, gameMode, savingsMode, useLocalAI, interventionUsed, rescues_used, game_over, storySummary, dm_prep)
  VALUES (?, 'The Goblin King Caverns', 'cave-1', 'The Goblin King Lair', 8, 'seed-s1-c2', 'thrilling adventure', 'normal', 'fast', 0, 0, 0, 0, 0, ?, NULL)`)
  .run(S1, 'The party delved into the goblin caves seeking a stolen artifact. They fought through waves of goblin sentries, discovered a map to the throne room, and now stand before the Goblin King himself.');

seedChar(S1, 'seed-s1-c1', 'Barnabas Strongarm', 'Fighter', 'Dwarf', 'Talks to his axe like it is a person', 5, 1, 1, 7, 10);
seedChar(S1, 'seed-s1-c2', 'Zara the Nimble', 'Rogue', 'Halfling', 'Compulsively collects shiny objects', 1, 2, 4, 6, 10);
seedChar(S1, 'seed-s1-c3', 'Eldwin Spark', 'Mage', 'Elf', 'Speaks only in riddles when nervous', 1, 5, 1, 5, 10);
seedChar(S1, 'seed-s1-c4', 'Mira the Bold', 'Cleric', 'Human', 'Blesses everything she touches', 2, 4, 1, 8, 10);

seedItem('seed-s1-c4', '🧪 Healing Potion', 'Restores 4 HP to the target', 4, null, 1, 1);
seedItem('seed-s1-c3', '🔮 Arcane Focus', 'Boosts spell power', null, JSON.stringify({ magic: 2 }), 0, 0);
seedItem('seed-s1-c1', '🪓 Battle Axe +1', 'A well-balanced axe', null, JSON.stringify({ might: 1 }), 0, 0);

seedTurn(S1, null, 'Your party descends into the damp, torchlit tunnels of the goblin warrens. Goblin sentries chitter in the shadows ahead. The smell of old bones and stolen treasure hangs in the air.', CHOICES_COMBAT, null, null, null, null, null);
seedTurn(S1, 'seed-s1-c1', 'Barnabas charges the nearest sentry with a bellowing warcry. His axe connects solidly and the goblin goes flying. Two more leap from the shadows!', CHOICES_COMBAT, 'Strike with your weapon', 'might', 1, 14, 5, 'normal', null, 12);
seedTurn(S1, 'seed-s1-c2', 'Zara darts between the goblins with supernatural speed, filching a shiny brass key from a guard while tripping another. The goblins are furious.', CHOICES_EXPLORE, 'Dodge and find an opening', 'mischief', 1, 17, 4, 'normal', null, 15);
seedTurn(S1, 'seed-s1-c3', 'Eldwin conjures a blinding flash that staggers the remaining guards. "Why did the mage cross the cave?" he mutters. "Because it was lit!" The path ahead is clear.', CHOICES_EXPLORE, 'Cast a spell', 'magic', 1, 16, 5, 'normal', null, 11);
seedTurn(S1, 'seed-s1-c4', 'Mira touches the ancient door and it swings open with a holy glow. Beyond lies a treasure room and a map showing the throne room - right above you.', CHOICES_SOCIAL, 'Examine with magic', 'magic', 1, 13, 4, 'normal', null, 11);
seedTurn(S1, 'seed-s1-c1', 'The Goblin King roars from his throne of stolen loot. "Intrudersss! KILL THEM!" He hurls a jagged crown like a disc weapon. Barnabas barely ducks in time.', CHOICES_COMBAT, 'Search the area carefully', 'mischief', 0, 4, 1, 'normal', null, 8);
seedTurn(S1, 'seed-s1-c2', 'Zara spots a hidden lever behind the throne - if she can reach it, the cage trap above the king might spring. The king is distracted by Barnabas.', CHOICES_COMBAT, 'Search the area carefully', 'mischief', 1, 19, 4, 'normal', null, 8, '🎲 A focused eye! You spot the mechanism.');

// ── Session 2: The Dragon's Peak (includes intervention + sanctuary) ──────────

const S2 = 'seed-session-2';
deleteSession(S2);
db.prepare(`INSERT INTO sessions (id, scene, sceneId, displayName, turn, activeCharacterId, tone, difficulty, gameMode, savingsMode, useLocalAI, interventionUsed, rescues_used, game_over, storySummary, dm_prep)
  VALUES (?, 'The Dragon Peak Summit', 'peak-3', 'Dragon Peak', 10, 'seed-s2-c1', 'epic and dangerous', 'hard', 'balanced', 0, 0, 1, 1, 0, ?, NULL)`)
  .run(S2, 'The party climbed the treacherous Dragon Peak to retrieve a stolen dragon egg. They survived an ambush by cultists, fell off a cliff only to be saved by a mysterious dragon, woke in a mountain shelter, and now face the final cultist stronghold.');

seedChar(S2, 'seed-s2-c1', 'Vex the Wanderer', 'Rogue', 'Tiefling', 'Leaves a coin wherever they go as a calling card', 2, 2, 5, 5, 10);
seedChar(S2, 'seed-s2-c2', 'Solara Brightblade', 'Paladin', 'Half-Elf', 'Sings battle hymns slightly off-key', 4, 2, 1, 8, 10);
seedChar(S2, 'seed-s2-c3', 'Grimble', 'Wizard', 'Gnome', 'Cannot stop inventing gadgets at the worst moments', 1, 5, 1, 6, 10);
seedChar(S2, 'seed-s2-c4', 'The Unnamed One', 'Barbarian', 'Half-Orc', 'Claims to have no name but answers to anything', 5, 1, 1, 9, 10);

seedItem('seed-s2-c2', '💧 Holy Water Flask', 'Deals 5 extra damage to corrupted foes', 5, null, 1, 1);
seedItem('seed-s2-c3', '💨 Experimental Smoke Bomb', 'Creates obscuring smoke', null, JSON.stringify({ mischief: 2 }), 1, 1);

seedTurn(S2, null, 'The summit of Dragon Peak looms above the clouds. The stolen egg pulses with amber light somewhere above. Cultists in obsidian armor guard the narrow path ahead.', CHOICES_COMBAT, null, null, null, null, null);
seedTurn(S2, 'seed-s2-c4', 'The Unnamed One launches into a fury, hurling cultists off the path like ragdolls. The mountain shakes with each strike. "NAME ME AFTER THIS BATTLE!" they roar.', CHOICES_COMBAT, 'Strike with your weapon', 'might', 1, 18, 5, 'normal', null, 12);
seedTurn(S2, 'seed-s2-c3', 'Grimble triggers his latest gadget - a grappling claw - and it malfunctions spectacularly, launching him off the cliff edge. Everyone watches in horror.', CHOICES_COMBAT, 'Search the area carefully', 'mischief', 0, 2, 1, 'normal', null, 8);
seedTurn(S2, 'seed-s2-c1', 'Vex tries to grab Grimble but both plummet. Solara and The Unnamed One are now alone facing the cultist high priest, who calls down lightning. Both are struck down.', CHOICES_COMBAT, 'Dodge and find an opening', 'mischief', 0, 3, 2, 'normal', null, 15);

// Intervention turn - dragon rescue
seedTurn(S2, null, 'From the storm clouds above, an ancient dragon with scales like burnished copper erupts with a thunderous roar! It snatches the falling party members mid-air and deposits them back on the path, breathing a warm golden flame that stabilizes them. "Not yet, little ones," it rumbles. "The egg must be returned."', [
  { label: 'Thank the dragon and ask for guidance', difficulty: 'easy', stat: 'mischief', difficultyValue: 7 },
  { label: 'Rally to fight the high priest', difficulty: 'hard', stat: 'might', difficultyValue: 16 },
  { label: 'Use the chaos to slip past', difficulty: 'normal', stat: 'mischief', difficultyValue: 11 },
], null, null, null, null, null, 'intervention', '/images/intervention_dragon.png');

seedTurn(S2, 'seed-s2-c1', 'Vex uses the dragon distraction to slip behind the high priest and drive a blade into the gap in his armor. The priest staggers - but calls for his elite guard.', CHOICES_COMBAT, 'Dodge and find an opening', 'mischief', 1, 16, 5, 'normal', null, 15);
seedTurn(S2, 'seed-s2-c2', 'Solara battles the elite guard heroically but takes a vicious hit. With a final desperate swing she shatters the guard captain\'s shield. Both sides are exhausted and the party is overwhelmed again.', CHOICES_COMBAT, 'Strike with your weapon', 'might', 0, 5, 4, 'normal', null, 12, '🎲 A heavy blow, but your defense falters.');

// Sanctuary turn
seedTurn(S2, null, 'The party wakes in a warm stone alcove carved into the mountainside - a hermit\'s shelter, long abandoned. Healing herbs hang from the ceiling and a small fire still burns. Outside, the storm howls. Someone bandaged your wounds while you slept. On the wall, scratched in common: "Courage returns with rest." Each of you feels the ache of battle but also the slow return of strength.', [
  { label: 'Search the shelter for supplies', difficulty: 'easy', stat: 'mischief', difficultyValue: 7 },
  { label: 'Plan the next assault', difficulty: 'easy', stat: 'magic', difficultyValue: 6 },
  { label: 'Head back up immediately', difficulty: 'hard', stat: 'might', difficultyValue: 16 },
], null, null, null, null, null, 'sanctuary', '/images/sanctuary_light.png');

// ── Session 3: The Merchant's Mystery ────────────────────────────────────────

const S3 = 'seed-session-3';
deleteSession(S3);
db.prepare(`INSERT INTO sessions (id, scene, sceneId, displayName, turn, activeCharacterId, tone, difficulty, gameMode, savingsMode, useLocalAI, interventionUsed, rescues_used, game_over, storySummary, dm_prep)
  VALUES (?, 'The Whispering Market', 'market-2', 'The Merchant Mystery', 6, 'seed-s3-c2', 'mysterious and intriguing', 'easy', 'cinematic', 0, 0, 0, 0, 0, ?, NULL)`)
  .run(S3, 'The party was hired to find a missing merchant\'s shipment. They discovered the cargo was actually a locked chest containing a cursed music box. The local thieves\' guild is also searching for it and may be watching.');

seedChar(S3, 'seed-s3-c1', 'Pipwick', 'Bard', 'Gnome', 'Turns every conversation into a song', 1, 2, 4, 7, 10);
seedChar(S3, 'seed-s3-c2', 'Thalia Stone', 'Ranger', 'Human', 'Has a pet crow named "Taxes"', 3, 1, 3, 8, 10);
seedChar(S3, 'seed-s3-c3', 'Brother Oswin', 'Cleric', 'Human', 'Apologizes to every creature before attacking it', 2, 4, 1, 9, 10);
seedChar(S3, 'seed-s3-c4', 'Mirela Voss', 'Sorcerer', 'Tiefling', 'Sparks fly from her hair when she lies', 1, 5, 1, 7, 10);

seedItem('seed-s3-c3', '🩹 Healing Salve', 'Restores 3 HP when applied', 3, null, 1, 1);
seedItem('seed-s3-c1', '🎸 Lute of Distraction', 'Creates minor illusions', null, JSON.stringify({ mischief: 1 }), 0, 0);

seedTurn(S3, null, 'The Whispering Market is alive with haggling merchants and suspicious glances. You have a tip that the missing shipment passed through here three days ago. The merchant\'s contact - a nervous man named Fil - is supposed to meet you at the spice stall.', CHOICES_SOCIAL, null, null, null, null, null);
seedTurn(S3, 'seed-s3-c1', 'Pipwick plays a cheerful tune near the spice stall and Fil visibly relaxes. He whispers that the chest was taken by someone in a red cloak - and he saw the same person at the dockside warehouse.', CHOICES_EXPLORE, 'Persuade them', 'mischief', 1, 15, 4, 'normal', null, 11);
seedTurn(S3, 'seed-s3-c2', 'Thalia sends Taxes (her crow) ahead to scout the warehouse. The bird returns with a torn piece of red cloth and - oddly - humming. The music box is in there.', CHOICES_EXPLORE, 'Search the area carefully', 'mischief', 1, 12, 3, 'normal', null, 8);
seedTurn(S3, 'seed-s3-c3', 'Brother Oswin examines the cloth and senses a dark enchantment. "Sorry in advance," he murmurs to the cursed fabric before casting a ward. The curse partially lifts - the box is somewhere on the upper floor.', CHOICES_SOCIAL, 'Examine with magic', 'magic', 1, 14, 4, 'normal', null, 11);
seedTurn(S3, 'seed-s3-c4', 'Mirela attempts to unlock the warehouse side door with a spell but a hidden glyph triggers an alarm. Sparks fly from her hair - she was NOT lying about the door being unlocked. Guards converge.', CHOICES_COMBAT, 'Cast a spell', 'magic', 0, 7, 5, 'normal', null, 11);
seedTurn(S3, 'seed-s3-c2', 'Thalia notches an arrow and shoots out the lantern above the guards, plunging the alley into darkness. The party has seconds to decide - fight, flee, or find another way in.', CHOICES_COMBAT, 'Search the area carefully', 'mischief', 1, 16, 3, 'normal', null, 8, '🎲 Sharp eyes in the dark. The arrow flies true.');

// ── Session 4: ZUG-MA-GEDDON - Endless Arena ─────────────────────────────────

const S4 = 'seed-session-4';
deleteSession(S4);
db.prepare(`INSERT INTO sessions (id, scene, sceneId, displayName, turn, activeCharacterId, tone, difficulty, gameMode, savingsMode, useLocalAI, interventionUsed, rescues_used, game_over, storySummary, dm_prep)
  VALUES (?, 'The Bloodpit Arena', 'arena-1', 'ZUG-MA-GEDDON: The Endless Arena', 5, 'seed-s4-c2', 'pure chaos and carnage', 'hard', 'zug-ma-geddon', 0, 0, 0, 0, 0, ?, NULL)`)
  .run(S4, 'You were thrown into the Bloodpit Arena by persons unknown. There is no escape. There is only combat. The crowd chants ZUG. ZUG. ZUG.');

seedChar(S4, 'seed-s4-c1', 'Krag Bonecrusher', 'Barbarian', 'Half-Orc', 'Cannot whisper - only screams', 6, 1, 1, 4, 12);
seedChar(S4, 'seed-s4-c2', 'Spark', 'Sorcerer', 'Tiefling', 'Accidentally sets things on fire when excited', 1, 6, 1, 5, 8);
seedChar(S4, 'seed-s4-c3', 'Dagmar Ironfist', 'Fighter', 'Dwarf', 'Headbutts doors instead of opening them', 5, 1, 2, 6, 10);

seedItem('seed-s4-c1', '🍖 Mystery Meat', 'Restores 3 HP (best not to ask what it is)', 3, null, 1, 1);
seedItem('seed-s4-c2', '⚡ Crackling Orb', 'Supercharges the next spell', null, JSON.stringify({ magic: 3 }), 0, 0);

seedTurn(S4, null, 'THE GATES CRASH OPEN. An armored troll the size of a house charges your position bellowing "ZUG ZUG ZUG". The crowd roars. Blood has not yet been spilled. This is about to change.', CHOICES_COMBAT, null, null, null, null, null);
seedTurn(S4, 'seed-s4-c1', 'Krag SCREAMS and charges headfirst into the troll. The collision shakes the arena floor. The troll stumbles. Krag is bleeding. The crowd loses their minds.', CHOICES_COMBAT, 'Strike with your weapon', 'might', 1, 18, 6, 'normal', null, 14);
seedTurn(S4, 'seed-s4-c2', 'Spark\'s hair ignites with excitement as three bolts of lightning explode from her fingertips. The troll is scorched black and FURIOUS. It swipes Spark off her feet for 3 damage.', CHOICES_COMBAT, 'Cast a spell', 'magic', 0, 5, 6, 'normal', null, 14);
seedTurn(S4, 'seed-s4-c3', 'Dagmar headbutts the troll\'s kneecap - cracks it. The troll falls to one knee. The entire arena is on its feet screaming. A second gate is already opening.', CHOICES_COMBAT, 'Strike with your weapon', 'might', 1, 15, 5, 'normal', null, 12);
seedTurn(S4, 'seed-s4-c1', 'The troll collapses. Gate two opens. An ogre with a giant net and a grin enters. Behind it: three more goblins riding armored wolves. The DM cackles.', CHOICES_COMBAT, 'Dodge and find an opening', 'mischief', 1, 19, 6, 'normal', null, 15, '🎲 Pure instinct. The crowd chants your name.');

// ── Session 5: The Shattered Crown (DM-prepped campaign) ─────────────────────

const S5 = 'seed-session-5';
deleteSession(S5);

const S5_DM_PREP = `CAMPAIGN: The Shattered Crown

PREMISE: The king is dead. His crown - a relic that keeps the realm's three factions (the Ironveil Knights, the Tideborn Merchants, the Ashwood Druids) from open war - was shattered into three shards. Each faction seized one shard. The party must recover all three before the next new moon, or the realm descends into civil war.

VILLAIN: Lord Castor Vane, the king's spymaster. He engineered the assassination and the crown's theft. He plays each faction against the other while secretly collecting the shards for himself. He is charming, always one step ahead, and has informants everywhere. He should appear helpful at first.

KEY LOCATIONS:
- Ironveil Keep: A fortress in the northern hills. The Knights believe the shard grants them divine right to the throne. Their leader, Commander Ressa, is honorable but proud.
- Tideborn Docks: A merchant quarter by the sea. The Merchants want to auction the shard to the highest bidder. Their broker, a gnome called Nix, is slippery and motivated purely by coin.
- Ashwood Grove: An ancient forest. The Druids believe the crown fragments are corrupting the land and must be unmade, not reunited. High Druid Sylva is stern but not wrong - the crown IS cursed.

CHALLENGES:
- Each faction demands a favour before handing over their shard (a quest within the quest).
- Lord Vane keeps sabotaging handoffs - the party may not realise he is behind it at first.
- The curse: carrying two or more shards causes visions and slowly drains HP each long rest. The party must carry them anyway.

GOALS:
- Short term: earn the trust of at least one faction.
- Mid term: expose Lord Vane's involvement before he claims all three shards.
- Long term: reunite the crown and place it on a worthy successor (the party can nominate).

PITFALLS:
- Do not let the party skip straight to Vane - he should be revealed gradually over 6-8 turns.
- The Druids are not wrong about the curse. If the party ignores the corruption angle, the crown reunion should have a cost.
- Nix the broker will sell info about the party to Vane if given the chance. Let this happen once for drama.`;

db.prepare(`INSERT INTO sessions (id, scene, sceneId, displayName, turn, activeCharacterId, tone, difficulty, gameMode, savingsMode, useLocalAI, interventionUsed, rescues_used, game_over, storySummary, dm_prep)
  VALUES (?, 'The Shattered Throne Room', 'throne-1', 'The Shattered Crown', 4, 'seed-s5-c1', 'political intrigue and rising danger', 'normal', 'balanced', 0, 0, 0, 0, 0, ?, ?)`)
  .run(S5,
    'The king was found dead at dawn. His crown - the symbol of peace between three rival factions - was shattered. The party was caught near the scene and pressed into service by the royal guard: find the three crown shards before the new moon, or face the noose.',
    S5_DM_PREP);

seedChar(S5, 'seed-s5-c1', 'Lira Dawnveil', 'Ranger', 'Half-Elf', 'Cannot resist investigating anything suspicious', 3, 2, 3, 9, 10);
seedChar(S5, 'seed-s5-c2', 'Brother Cask', 'Cleric', 'Dwarf', 'Keeps a journal of every person he meets', 1, 5, 1, 8, 10);
seedChar(S5, 'seed-s5-c3', 'Fenwick Tallow', 'Rogue', 'Human', 'Has a fake noble title he insists is real', 1, 2, 5, 7, 10);
seedChar(S5, 'seed-s5-c4', 'Sable', 'Sorcerer', 'Tiefling', 'Her shadow moves independently when she is lying', 1, 5, 1, 6, 10);

seedItem('seed-s5-c2', '📖 Royal Writ', 'Grants access to guarded areas (single use)', null, null, 1, 0);
seedItem('seed-s5-c1', '🏹 Faction Arrow', 'Inscribed with all three faction seals - a symbol of neutrality', null, JSON.stringify({ mischief: 1 }), 0, 0);

const CHOICES_INTRIGUE = [
  { label: 'Question the palace steward', difficulty: 'normal', stat: 'mischief', difficultyValue: 11, narration: 'A careful ear might unravel who was in the throne room at dawn.' },
  { label: 'Inspect the shattered crown case', difficulty: 'easy', stat: 'magic', difficultyValue: 8, narration: 'The residue of magic lingers on every crime scene.' },
  { label: 'Follow the guard captain', difficulty: 'hard', stat: 'mischief', difficultyValue: 15, narration: 'She is hiding something - you can see it in her eyes.' },
];

seedTurn(S5, null,
  'The throne room smells of cold stone and dried blood. The shattered crown case stands open, three empty slots where the shards should sit. Royal guards eye you with open suspicion. A man in a dark doublet - Lord Castor Vane, the royal spymaster - offers you a thin smile from across the room. "How fortunate," he says. "The investigation now has... volunteers."',
  CHOICES_INTRIGUE, null, null, null, null, null, 'normal', null, null, null, 'low', null);

seedTurn(S5, 'seed-s5-c1',
  'Lira examines the shattered case and finds traces of a suppression ward - someone masked the theft from palace detection magic. This was planned weeks in advance. Vane watches her work with quiet approval.',
  [
    { label: 'Head to Ironveil Keep first', difficulty: 'normal', stat: 'might', difficultyValue: 10, narration: 'The Knights will not welcome uninvited guests.' },
    { label: 'Seek out the broker Nix at the docks', difficulty: 'normal', stat: 'mischief', difficultyValue: 11, narration: 'Coin talks louder than authority in the Tideborn quarter.' },
    { label: 'Ask Vane what he knows', difficulty: 'hard', stat: 'magic', difficultyValue: 14, narration: 'Something about him feels wrong - trust your instincts.' },
  ],
  'Inspect the shattered crown case', 'magic', 1, 13, 5, 'normal', null, 8, null, 'low', null);

seedTurn(S5, 'seed-s5-c3',
  'Fenwick introduces himself to Vane as "Lord Fenwick of the Eastern Reaches." Vane does not blink. He hands Fenwick a sealed letter of passage and says: "The Knights are proud. Show them respect first and ask questions second." He is helpful. Almost too helpful.',
  [
    { label: 'Ride for Ironveil Keep', difficulty: 'easy', stat: 'might', difficultyValue: 7, narration: 'The road north is long - but the Knights hold one shard.' },
    { label: 'Open the letter before delivering it', difficulty: 'normal', stat: 'mischief', difficultyValue: 12, narration: 'Breaking a spymaster\'s seal could answer a lot of questions.' },
    { label: 'Warn the others about Vane in private', difficulty: 'easy', stat: 'mischief', difficultyValue: 6, narration: 'Something is wrong. The others need to know.' },
  ],
  'Question the palace steward', 'mischief', 1, 16, 5, 'normal', null, 11, null, 'medium', null);

seedTurn(S5, 'seed-s5-c4',
  'Sable\'s shadow stretches toward Vane unprompted. She does not mention this to anyone. On the road to Ironveil Keep the party is ambushed by masked riders - they are not bandits. Their armor bears a hidden crest: Vane\'s personal sigil. Someone does not want you to reach the Knights.',
  [
    { label: 'Fight the masked riders', difficulty: 'hard', stat: 'might', difficultyValue: 14, narration: 'Steel against steel - and answers, if you take one alive.' },
    { label: 'Flee into the forest', difficulty: 'normal', stat: 'mischief', difficultyValue: 11, narration: 'A retreat now saves strength for the Keep.' },
    { label: 'Call out Vane\'s crest aloud', difficulty: 'normal', stat: 'magic', difficultyValue: 10, narration: 'Naming your enemy may rattle them - or provoke a worse response.' },
  ],
  'Warn the others about Vane in private', 'mischief', 0, 5, 5, 'normal', null, 6, '🎲 The words catch in her throat. The riders close in.', 'high', JSON.stringify([
    { characterId: 'seed-s5-c4', characterName: 'Sable', change: -2, newHp: 4, maxHp: 6 },
  ]));

// ── Session 6: The Tomb of Endless Dark (GAME OVER - fallen campaign) ────────

const S6 = 'seed-session-6';
deleteSession(S6);
db.prepare(`INSERT INTO sessions (id, scene, sceneId, displayName, turn, activeCharacterId, tone, difficulty, gameMode, savingsMode, useLocalAI, interventionUsed, rescues_used, game_over, storySummary, dm_prep)
  VALUES (?, 'The Sunken Sanctum - Final Chamber', 'tomb-final', 'The Tomb of Endless Dark', 14, 'seed-s6-c1', 'desperate and doomed', 'hard', 'balanced', 0, 0, 1, 1, 1, ?, NULL)`)
  .run(S6, 'The party ventured into the ancient Tomb of Endless Dark seeking a legendary relic. They survived traps, undead hordes, and an Arcane Wraith that nearly killed them all - saved only by a dragon intervention. Battered and desperate they pressed on into the final sanctum. The Lich Lord was waiting. He was ready. They were not.');

seedChar(S6, 'seed-s6-c1', 'Aldric the Steadfast', 'Fighter', 'Human', 'Never retreats - not even once', 5, 1, 1, 0, 10, 'downed');
seedChar(S6, 'seed-s6-c2', 'Yenna Ashveil', 'Witch', 'Half-Elf', 'Whispers apologies to her spells before casting them', 1, 5, 1, 0, 10, 'downed');
seedChar(S6, 'seed-s6-c3', 'Rutger', 'Barbarian', 'Human', 'Laughs loudest when things are most dire', 5, 1, 2, 0, 12, 'downed');
seedChar(S6, 'seed-s6-c4', 'Pip Quickfingers', 'Rogue', 'Halfling', 'Steals things reflexively, even from friends', 1, 2, 5, 0, 8, 'downed');

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

seedTurn(S6, null, 'The Tomb of Endless Dark swallows all light. Somewhere ahead the relic pulses with a cold blue glow. The air smells of centuries of rot and old magic. Something ancient knows you are here.', CHOICES_TOMB, null, null, null, null, null, 'normal', null, null, null, 'medium', null);
seedTurn(S6, 'seed-s6-c1', 'Aldric shoulders open the first sealed door, his jaw set. Beyond: a corridor lined with standing sarcophagi. Twenty. Maybe more. Their stone lids begin to tremble.', CHOICES_TOMB, 'Press forward into the dark', 'might', 1, 15, 5, 'normal', null, 12, null, 'medium', null);
seedTurn(S6, 'seed-s6-c2', 'Yenna whispers an apology to her detection spell and casts it wide. Three pressure plates revealed, two concealed pits - and something massive in the walls, waiting. "Sorry," she breathes. "Very sorry."', CHOICES_TOMB, 'Detect magical traps', 'magic', 1, 14, 5, 'normal', null, 11, null, 'medium', null);
seedTurn(S6, 'seed-s6-c3', 'The sarcophagi burst open. Rutger laughs the loudest laugh of his life and wades in with both fists. Skeletal warriors shatter against him. Twelve down. Eight remaining. He is still laughing.', CHOICES_TOMB, 'Press forward into the dark', 'might', 1, 19, 5, 'normal', null, 12, '🎲 Absolute carnage. The skeletons regret rising.', 'high', null);
seedTurn(S6, 'seed-s6-c4', 'Pip filches a glowing amulet from a skeletal captain mid-combat, purely by reflex. It hums with warmth. Then an Arcane Wraith materializes from the ceiling - and the warmth turns cold.', CHOICES_LICH, 'Scout ahead in the shadows', 'mischief', 1, 17, 5, 'normal', null, 14, null, 'high', null);
seedTurn(S6, 'seed-s6-c1', 'The Wraith passes through Aldric\'s armor like smoke. He staggers, 4 HP gone. But he grabs its ethereal form with iron will and slams it into the floor. For a moment it is solid. Just a moment.', CHOICES_LICH, 'Strike the Lich Lord directly', 'might', 0, 6, 5, 'normal', null, 16, '🎲 A desperate grab - not enough.', 'high', JSON.stringify([{ characterId: 'seed-s6-c1', characterName: 'Aldric the Steadfast', change: -4, newHp: 4, maxHp: 10 }]));
seedTurn(S6, 'seed-s6-c2', 'Yenna pours everything into a banishment hex. The Wraith shrieks and dissolves. She collapses to her knees, spent. The party stands in silence. Then: slow, deliberate clapping from the chamber ahead.', CHOICES_LICH, 'Shatter his phylactery with magic', 'magic', 1, 18, 5, 'normal', null, 16, '🎲 The spell lands. The Wraith unmakes itself screaming.', 'high', null);

// Dragon intervention
seedTurn(S6, null, 'The Lich Lord\'s first strike drops the entire party to zero. From somewhere impossibly far above, a copper dragon\'s roar shakes dust from the ceiling. A beam of golden light threads down through cracked stone and touches each fallen hero. "Not here," the dragon\'s voice echoes through the rock. "Not like this." The party gasps back to 1 HP each. The Lich Lord tilts his skull with academic curiosity. "Fascinating. Try again."', [
  { label: 'Charge the Lich Lord while he is distracted', difficulty: 'hard', stat: 'might', difficultyValue: 16 },
  { label: 'Shatter the phylactery on the altar', difficulty: 'hard', stat: 'magic', difficultyValue: 17 },
  { label: 'Grab the relic and find an exit', difficulty: 'hard', stat: 'mischief', difficultyValue: 15 },
], null, null, null, null, null, 'intervention', '/images/intervention_dragon.png', null, null, 'high', null);

seedTurn(S6, 'seed-s6-c3', 'Rutger laughs one last time - quieter this time, almost fond - and charges the Lich Lord with everything he has. The blow lands. The phylactery cracks. One more hit and it shatters. The Lich Lord is not amused.', CHOICES_LICH, 'Charge the Lich Lord while he is distracted', 'might', 1, 17, 5, 'normal', null, 16, '🎲 The mightiest blow of his life. The crack spreads.', 'high', null);
seedTurn(S6, 'seed-s6-c4', 'Pip lunges for the phylactery - fingertips brush the cracked surface - but the Lich Lord\'s hand closes around his wrist. "Charming effort," the Lich says. Pip takes 5 damage and goes down.', CHOICES_LICH, 'Steal the phylactery and run', 'mischief', 0, 4, 5, 'normal', null, 15, '🎲 So close. The hand closes too fast.', 'high', JSON.stringify([{ characterId: 'seed-s6-c4', characterName: 'Pip Quickfingers', change: -5, newHp: 0, maxHp: 8 }]));
seedTurn(S6, 'seed-s6-c1', 'Aldric steps over Pip and plants himself between the Lich and the others. His sword arm shaking. His voice steady: "You will not have them." He charges. He is struck down before he reaches the throne.', CHOICES_LICH, 'Strike the Lich Lord directly', 'might', 0, 3, 5, 'normal', null, 16, '🎲 The bravest roll of a doomed hand.', 'high', JSON.stringify([{ characterId: 'seed-s6-c1', characterName: 'Aldric the Steadfast', change: -3, newHp: 0, maxHp: 10 }]));
seedTurn(S6, 'seed-s6-c2', 'Yenna and Rutger fight on alone. Yenna\'s last spell flickers out. Rutger\'s laughter stops. The phylactery holds. The Lich Lord dims the room with a gesture. When the light returns, the chamber is silent.', CHOICES_LICH, 'Shatter his phylactery with magic', 'magic', 0, 2, 5, 'normal', null, 17, '🎲 The magic dies in her hands. Nothing left.', 'high', JSON.stringify([
  { characterId: 'seed-s6-c2', characterName: 'Yenna Ashveil', change: -4, newHp: 0, maxHp: 10 },
  { characterId: 'seed-s6-c3', characterName: 'Rutger', change: -3, newHp: 0, maxHp: 12 },
]));

// Update session active characters
db.prepare('UPDATE sessions SET activeCharacterId = ? WHERE id = ?').run('seed-s1-c2', S1);
db.prepare('UPDATE sessions SET activeCharacterId = ? WHERE id = ?').run('seed-s2-c1', S2);
db.prepare('UPDATE sessions SET activeCharacterId = ? WHERE id = ?').run('seed-s3-c2', S3);
db.prepare('UPDATE sessions SET activeCharacterId = ? WHERE id = ?').run('seed-s4-c2', S4);
db.prepare('UPDATE sessions SET activeCharacterId = ? WHERE id = ?').run('seed-s5-c1', S5);
db.prepare('UPDATE sessions SET activeCharacterId = ? WHERE id = ?').run('seed-s6-c1', S6);

console.log('Seed complete:');
console.log(`  Session 1 (${S1}): The Goblin King's Lair - 4 chars, 7 turns`);
console.log(`  Session 2 (${S2}): Dragon's Peak - 4 chars, 10 turns (intervention + sanctuary)`);
console.log(`  Session 3 (${S3}): The Merchant's Mystery - 4 chars, 6 turns`);
console.log(`  Session 4 (${S4}): ZUG-MA-GEDDON - The Endless Arena - 3 chars, 5 turns`);
console.log(`  Session 5 (${S5}): The Shattered Crown - 4 chars, 4 turns (DM prep + intrigue)`);
console.log(`  Session 6 (${S6}): The Tomb of Endless Dark - 4 chars, 13 turns (GAME OVER - hard, 1 rescue used)`);
