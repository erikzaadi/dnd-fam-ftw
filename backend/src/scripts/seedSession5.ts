// Session 5: The Shattered Crown - a political intrigue campaign with a fully populated DM prep + encounter seeds + one past encounter.
// Showcases: dm_prep + dm_prep_image_brief + dm_prep_encounters + past_encounters fields, rising tension arc, a villain who appears helpful, hpChanges on a failed roll.
import type { Database as DB } from 'libsql';
import { deleteSession, seedChar, seedItem, seedTurn } from './seedHelpers.js';

export const SESSION_ID = 'seed-session-5';

const DM_PREP = `CAMPAIGN: The Shattered Crown

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

const DM_PREP_IMAGE_BRIEF = 'charming royal spymaster, three glowing crown shards, tense throne room, proud knights, sea merchants, stern forest druids, masked riders, cursed relic magic';

const DM_PREP_ENCOUNTERS = JSON.stringify([
  {
    name: "Vane's Masked Riders",
    triggerHint: 'when party rides for Ironveil Keep',
    enemies: [
      { name: 'Masked Rider', role: 'minion', weaknesses: [{ label: 'holy light', school: 'holy' }], traits: ['mounted', 'disciplined'] },
      { name: 'Rider Captain', role: 'standard', weaknesses: [{ label: 'shadow reveal', school: 'shadow' }], traits: ['tactician', "wears Vane's crest"] },
    ],
    areas: [{ label: 'Forest Road Ambush', tags: ['forest', 'narrow path', 'ambush'] }],
    objective: 'Capture a rider alive to learn who sent them',
    lootHint: "sealed letter bearing Vane's personal crest",
  },
  {
    name: 'Ironveil Gate Guard',
    triggerHint: 'when party tries to enter Ironveil Keep without a pass',
    enemies: [
      { name: 'Ironveil Knight', role: 'standard', weaknesses: [{ label: 'feint and misdirect', school: 'mind' }], traits: ['armored', 'proud', 'obeys Commander Ressa'] },
    ],
    areas: [{ label: 'Ironveil Gatehouse', tags: ['fortified', 'chokepoint', 'torchlit'] }],
    objective: 'Prove worth or find another way in',
  },
  {
    name: "Nix's Dockside Enforcers",
    triggerHint: "when party gets too close to Nix's warehouse",
    enemies: [
      { name: 'Dock Enforcer', role: 'minion', weaknesses: [{ label: 'fire distraction', school: 'fire' }], traits: ['mercenary', 'paid by Nix'] },
      { name: "Nix's Bodyguard", role: 'elite', weaknesses: [{ label: 'social manipulation', school: 'mind' }], traits: ['brutal', 'loyal only to coin'] },
    ],
    areas: [{ label: 'Tideborn Dockside', tags: ['urban', 'dark alley', 'waterfront'] }],
    lootHint: 'tideborn shard fragment wrapped in merchant cloth',
  },
  {
    name: "Lord Vane's Inner Circle",
    triggerHint: 'when party confronts Lord Vane directly',
    enemies: [
      { name: 'Shadow Agent', role: 'elite', weaknesses: [{ label: 'holy light', school: 'holy' }], traits: ['stealthy', 'can call reinforcements'] },
      { name: 'Lord Castor Vane', role: 'boss', weaknesses: [{ label: 'truth magic', school: 'mind' }], traits: ['spymaster', 'charming', 'always has an escape route', "knows the party's secrets"] },
    ],
    areas: [{ label: "Vane's Private Study", tags: ['palace', 'narrow corridors', 'trapped'] }],
    objective: "Expose Vane and claim the final crown shard",
    lootHint: 'the final crown shard and written proof of the conspiracy',
  },
]);

const PAST_ENCOUNTERS = JSON.stringify([
  {
    id: 'enc-s5-palace-patrol',
    name: 'Palace Gate Patrol',
    status: 'defeated',
    round: 3,
    objective: 'Escape the courtyard without raising the full alarm',
    lastResolvedEnemyName: 'Gate Sergeant',
    enemies: [
      { id: 'e1', name: 'Palace Guard', role: 'minion', hp: 0, maxHp: 8, status: 'defeated', traits: ['armored'] },
      { id: 'e2', name: 'Palace Guard', role: 'minion', hp: 0, maxHp: 8, status: 'defeated', traits: ['armored'] },
      { id: 'e3', name: 'Gate Sergeant', role: 'standard', hp: 0, maxHp: 14, status: 'defeated', traits: ['disciplined', 'loyal to the crown'] },
    ],
    areas: [{ id: 'a1', label: 'Palace Courtyard', description: 'Torchlit cobblestones outside the throne room', tags: ['palace', 'open', 'torchlit'] }],
  },
]);

const CHOICES_INTRIGUE = [
  { label: 'Question the palace steward', difficulty: 'normal', stat: 'mischief', difficultyValue: 11, narration: 'A careful ear might unravel who was in the throne room at dawn.' },
  { label: 'Inspect the shattered crown case', difficulty: 'easy', stat: 'magic', difficultyValue: 8, narration: 'The residue of magic lingers on every crime scene.' },
  { label: 'Follow the guard captain', difficulty: 'hard', stat: 'mischief', difficultyValue: 15, narration: 'She is hiding something - you can see it in her eyes.' },
];

export function seed(db: DB): void {
  deleteSession(db, SESSION_ID);
  db.prepare(`INSERT INTO sessions (id, scene, sceneId, displayName, turn, activeCharacterId, tone, difficulty, gameMode, savingsMode, useLocalAI, interventionUsed, rescues_used, game_over, storySummary, dm_prep, dm_prep_image_brief, dm_prep_encounters, past_encounters)
    VALUES (?, 'The Shattered Throne Room', 'throne-1', 'The Shattered Crown', 4, 'seed-s5-c1', 'political intrigue and rising danger', 'normal', 'balanced', 0, 0, 0, 0, 0, ?, ?, ?, ?, ?)`)
    .run(SESSION_ID,
      'The king was found dead at dawn. His crown - the symbol of peace between three rival factions - was shattered. The party was caught near the scene and pressed into service by the royal guard: find the three crown shards before the new moon, or face the noose.',
      DM_PREP,
      DM_PREP_IMAGE_BRIEF,
      DM_PREP_ENCOUNTERS,
      PAST_ENCOUNTERS);

  seedChar(db, SESSION_ID, 'seed-s5-c1', 'Lira Dawnveil', 'Ranger', 'Half-Elf', 'Cannot resist investigating anything suspicious', 3, 2, 3, 9, 10);
  seedChar(db, SESSION_ID, 'seed-s5-c2', 'Brother Cask', 'Cleric', 'Dwarf', 'Keeps a journal of every person he meets', 1, 5, 1, 8, 10);
  seedChar(db, SESSION_ID, 'seed-s5-c3', 'Fenwick Tallow', 'Rogue', 'Human', 'Has a fake noble title he insists is real', 1, 2, 5, 7, 10);
  seedChar(db, SESSION_ID, 'seed-s5-c4', 'Sable', 'Sorcerer', 'Tiefling', 'Her shadow moves independently when she is lying', 1, 5, 1, 6, 10);

  seedItem(db, 'seed-s5-c2', 's5-i1', '📖 Royal Writ', 'Grants access to guarded areas (single use)', null, null, 1, 0);
  seedItem(db, 'seed-s5-c1', 's5-i2', '🏹 Faction Arrow', 'Inscribed with all three faction seals - a symbol of neutrality', null, JSON.stringify({ mischief: 1 }), 0, 0);

  seedTurn(db, SESSION_ID, null,
    'The throne room smells of cold stone and dried blood. The shattered crown case stands open, three empty slots where the shards should sit. Royal guards eye you with open suspicion. A man in a dark doublet - Lord Castor Vane, the royal spymaster - offers you a thin smile from across the room. "How fortunate," he says. "The investigation now has... volunteers."',
    CHOICES_INTRIGUE, null, null, null, null, null, 'normal', null, null, null, 'low', null);

  seedTurn(db, SESSION_ID, 'seed-s5-c1',
    'Lira examines the shattered case and finds traces of a suppression ward - someone masked the theft from palace detection magic. This was planned weeks in advance. Vane watches her work with quiet approval.',
    [
      { label: 'Head to Ironveil Keep first', difficulty: 'normal', stat: 'might', difficultyValue: 10, narration: 'The Knights will not welcome uninvited guests.' },
      { label: 'Seek out the broker Nix at the docks', difficulty: 'normal', stat: 'mischief', difficultyValue: 11, narration: 'Coin talks louder than authority in the Tideborn quarter.' },
      { label: 'Ask Vane what he knows', difficulty: 'hard', stat: 'magic', difficultyValue: 14, narration: 'Something about him feels wrong - trust your instincts.' },
    ],
    'Inspect the shattered crown case', 'magic', 1, 13, 5, 'normal', null, 8, null, 'low', null);

  seedTurn(db, SESSION_ID, 'seed-s5-c3',
    'Fenwick introduces himself to Vane as "Lord Fenwick of the Eastern Reaches." Vane does not blink. He hands Fenwick a sealed letter of passage and says: "The Knights are proud. Show them respect first and ask questions second." He is helpful. Almost too helpful.',
    [
      { label: 'Ride for Ironveil Keep', difficulty: 'easy', stat: 'might', difficultyValue: 7, narration: 'The road north is long - but the Knights hold one shard.' },
      { label: 'Open the letter before delivering it', difficulty: 'normal', stat: 'mischief', difficultyValue: 12, narration: 'Breaking a spymaster\'s seal could answer a lot of questions.' },
      { label: 'Warn the others about Vane in private', difficulty: 'easy', stat: 'mischief', difficultyValue: 6, narration: 'Something is wrong. The others need to know.' },
    ],
    'Question the palace steward', 'mischief', 1, 16, 5, 'normal', null, 11, null, 'medium', null);

  seedTurn(db, SESSION_ID, 'seed-s5-c4',
    'Sable\'s shadow stretches toward Vane unprompted. She does not mention this to anyone. On the road to Ironveil Keep the party is ambushed by masked riders - they are not bandits. Their armor bears a hidden crest: Vane\'s personal sigil. Someone does not want you to reach the Knights.',
    [
      { label: 'Fight the masked riders', difficulty: 'hard', stat: 'might', difficultyValue: 14, narration: 'Steel against steel - and answers, if you take one alive.' },
      { label: 'Flee into the forest', difficulty: 'normal', stat: 'mischief', difficultyValue: 11, narration: 'A retreat now saves strength for the Keep.' },
      { label: 'Call out Vane\'s crest aloud', difficulty: 'normal', stat: 'magic', difficultyValue: 10, narration: 'Naming your enemy may rattle them - or provoke a worse response.' },
    ],
    'Warn the others about Vane in private', 'mischief', 0, 5, 5, 'normal', null, 6, '🎲 The words catch in her throat. The riders close in.', 'high',
    JSON.stringify([{ characterId: 'seed-s5-c4', characterName: 'Sable', change: -2, newHp: 4, maxHp: 6 }]));
}
