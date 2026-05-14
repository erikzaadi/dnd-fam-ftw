// Session 1: The Goblin King's Lair - a classic dungeon crawl with a mixed party of four.
// Showcases: normal difficulty, fast game mode, multi-character turn sequence, basic inventory (healing potion, stat-bonus items), active encounter with encounterEnemyChanges on the final 2 turns.
import type { Database as DB } from 'libsql';
import { deleteSession, seedChar, seedItem, seedTurn, CHOICES_COMBAT, CHOICES_EXPLORE, CHOICES_SOCIAL } from './seedHelpers.js';

export const SESSION_ID = 'seed-session-1';

const ENCOUNTER_ID = 'enc-s1-goblin-king';

const ENCOUNTER_STATE = JSON.stringify({
  id: ENCOUNTER_ID,
  name: "The Goblin King's Throne",
  status: 'active',
  round: 2,
  objective: 'Defeat the Goblin King and claim the stolen artifact',
  enemies: [
    { id: 'e1', name: 'Goblin Sentry', role: 'minion', hp: 0, maxHp: 5, status: 'defeated', traits: ['sneaky'] },
    { id: 'e2', name: 'Goblin Sentry', role: 'minion', hp: 2, maxHp: 5, status: 'active', traits: ['sneaky'] },
    { id: 'e3', name: 'Goblin King', role: 'boss', hp: 14, maxHp: 20, status: 'active', traits: ['crown thrower', 'commanding', 'surrounded by loot'] },
  ],
  areas: [
    {
      id: 'a1',
      label: 'Throne Room',
      description: 'A cavernous chamber piled high with stolen loot and glittering junk. Rickety walkways circle a central pit.',
      tags: ['throne room', 'loot piles', 'open'],
      effect: 'Loose coins underfoot - anyone who sprints must roll or slip.',
      imageUrl: '/images/default_scene.png',
    },
  ],
});

export function seed(db: DB): void {
  deleteSession(db, SESSION_ID);
  db.prepare(`INSERT INTO sessions (id, scene, sceneId, displayName, turn, activeCharacterId, tone, difficulty, gameMode, savingsMode, useLocalAI, interventionUsed, rescues_used, game_over, storySummary, dm_prep, encounter_state)
    VALUES (?, 'The Goblin King Caverns', 'cave-1', 'The Goblin King Lair', 8, 'seed-s1-c2', 'thrilling adventure', 'normal', 'fast', 0, 0, 0, 0, 0, ?, NULL, ?)`)
    .run(SESSION_ID,
      'The party delved into the goblin caves seeking a stolen artifact. They fought through waves of goblin sentries, discovered a map to the throne room, and now stand before the Goblin King himself.',
      ENCOUNTER_STATE);

  seedChar(db, SESSION_ID, 'seed-s1-c1', 'Barnabas Strongarm', 'Fighter', 'Dwarf', 'Talks to his axe like it is a person', 5, 1, 1, 7, 10);
  seedChar(db, SESSION_ID, 'seed-s1-c2', 'Zara the Nimble', 'Rogue', 'Halfling', 'Compulsively collects shiny objects', 1, 2, 4, 6, 10);
  seedChar(db, SESSION_ID, 'seed-s1-c3', 'Eldwin Spark', 'Mage', 'Elf', 'Speaks only in riddles when nervous', 1, 5, 1, 5, 10);
  seedChar(db, SESSION_ID, 'seed-s1-c4', 'Mira the Bold', 'Cleric', 'Human', 'Blesses everything she touches', 2, 4, 1, 8, 10);

  seedItem(db, 'seed-s1-c4', 's1-i1', '🧪 Healing Potion', 'Restores 4 HP to the target', 4, null, 1, 1);
  seedItem(db, 'seed-s1-c3', 's1-i2', '🔮 Arcane Focus', 'Boosts spell power', null, JSON.stringify({ magic: 2 }), 0, 0);
  seedItem(db, 'seed-s1-c1', 's1-i3', '🪓 Battle Axe +1', 'A well-balanced axe', null, JSON.stringify({ might: 1 }), 0, 0);

  seedTurn(db, SESSION_ID, null, 'Your party descends into the damp, torchlit tunnels of the goblin warrens. Goblin sentries chitter in the shadows ahead. The smell of old bones and stolen treasure hangs in the air.', CHOICES_COMBAT, null, null, null, null, null);
  seedTurn(db, SESSION_ID, 'seed-s1-c1', 'Barnabas charges the nearest sentry with a bellowing warcry. His axe connects solidly and the goblin goes flying. Two more leap from the shadows!', CHOICES_COMBAT, 'Strike with your weapon', 'might', 1, 14, 5, 'normal', null, 12);
  seedTurn(db, SESSION_ID, 'seed-s1-c2', 'Zara darts between the goblins with supernatural speed, filching a shiny brass key from a guard while tripping another. The goblins are furious.', CHOICES_EXPLORE, 'Dodge and find an opening', 'mischief', 1, 17, 4, 'normal', null, 15);
  seedTurn(db, SESSION_ID, 'seed-s1-c3', 'Eldwin conjures a blinding flash that staggers the remaining guards. "Why did the mage cross the cave?" he mutters. "Because it was lit!" The path ahead is clear.', CHOICES_EXPLORE, 'Cast a spell', 'magic', 1, 16, 5, 'normal', null, 11);
  seedTurn(db, SESSION_ID, 'seed-s1-c4', 'Mira touches the ancient door and it swings open with a holy glow. Beyond lies a treasure room and a map showing the throne room - right above you.', CHOICES_SOCIAL, 'Examine with magic', 'magic', 1, 13, 4, 'normal', null, 11);
  seedTurn(db, SESSION_ID, 'seed-s1-c1', 'The Goblin King roars from his throne of stolen loot. "Intrudersss! KILL THEM!" He hurls a jagged crown like a disc weapon. Barnabas barely ducks in time, but his wild swing clips a sentry who crumples to the floor.', CHOICES_COMBAT, 'Strike with your weapon', 'might', 0, 4, 5, 'normal', null, 12, '🎲 Too slow - the king sidesteps with a cackle!', 'high', null, null, null, {},
    ENCOUNTER_ID, JSON.stringify([{ enemyId: 'e1', enemyName: 'Goblin Sentry', hpChange: -5, newStatus: 'defeated' }]));
  seedTurn(db, SESSION_ID, 'seed-s1-c2', 'Zara spots a hidden lever behind the throne - if she can reach it, the cage trap above the king might spring. The king is distracted by Barnabas.', CHOICES_COMBAT, 'Search the area carefully', 'mischief', 1, 19, 4, 'normal', null, 8, '🎲 A focused eye! You spot the mechanism.', 'high', null, null, null, {},
    ENCOUNTER_ID, JSON.stringify([{ enemyId: 'e3', enemyName: 'Goblin King', hpChange: -6 }]));
}
