// Synthetic NarrationInput fixtures shared by dmTurnOrchestrator unit tests and
// the preview-choices evaluation script (scripts/evaluatePreviewChoices.ts).
// Keep this module free of Vitest imports, mocks, and side effects: every
// factory returns a fresh object so attempts never share mutable state.
//
// The model-refresh fixture set is FROZEN once the first baseline run has been
// captured. Changing an input or expected fact invalidates comparisons against
// earlier runs; bump MODEL_REFRESH_FIXTURE_VERSION and recapture the baseline
// instead of editing silently.
import type { NarrationInput } from '../../providers/ai/narration/NarrationProvider.js';
import type { EncounterState, SceneMomentum } from '../../types.js';

// Minimal valid NarrationInput for tests
export const baseInput = (): NarrationInput => ({
  scene: 'A mossy corridor',
  party: [
    {
      name: 'Pip',
      class: 'Rogue',
      species: 'Halfling',
      hp: 8,
      maxHp: 10,
      stats: { might: 1, magic: 2, mischief: 4 },
      status: 'active',
    },
  ],
  inventory: [],
  actionAttempt: 'Sneak past the guard',
  actionResult: { success: true, summary: 'The action succeeded.' },
  recentHistory: [],
  tone: 'playful',
  gameMode: 'balanced',
});

export const MODEL_REFRESH_FIXTURE_VERSION = 1;

export type ChoicesFixtureCategory = 'exploration' | 'combat' | 'trade-loot' | 'healing-revival' | 'stale-top-stat';

export type ChoicesFixture = {
  id: string;
  category: ChoicesFixtureCategory;
  // 'relaxed' fixtures set isFirstTurn/interventionRescue/sanctuaryRecovery,
  // which gives the initial choices attempt 5000 ms instead of 3500 ms.
  deadline: 'ordinary' | 'relaxed';
  // Facts a human scorer checks against checklist items 2, 3, and 6.
  expectedFacts: string[];
  build: () => NarrationInput;
};

type PartyMember = NarrationInput['party'][number];
type InventoryItem = NarrationInput['inventory'][number];

const brom = (): PartyMember => ({
  name: 'Brom Ironbread',
  class: 'Fighter',
  species: 'Dwarf',
  hp: 14,
  maxHp: 16,
  stats: { might: 5, magic: 1, mischief: 2 },
  status: 'active',
  quirk: 'Talks to his axe',
});

const zara = (): PartyMember => ({
  name: 'Zara Spellsworth',
  class: 'Wizard',
  species: 'Elf',
  hp: 9,
  maxHp: 10,
  stats: { might: 1, magic: 5, mischief: 3 },
  status: 'active',
});

const finn = (): PartyMember => ({
  name: 'Finn Quickcrust',
  class: 'Rogue',
  species: 'Halfling',
  hp: 10,
  maxHp: 11,
  stats: { might: 2, magic: 1, mischief: 5 },
  status: 'active',
});

const mira = (): PartyMember => ({
  name: 'Mira Warmheal',
  class: 'Cleric',
  species: 'Human',
  hp: 12,
  maxHp: 12,
  stats: { might: 2, magic: 4, mischief: 1 },
  status: 'active',
});

// Unicode name coverage for prompt/schema round-trips
const soren = (): PartyMember => ({
  name: 'Søren Ælfwine',
  class: 'Ranger',
  species: 'Human',
  hp: 11,
  maxHp: 13,
  stats: { might: 4, magic: 2, mischief: 3 },
  status: 'active',
});

const yuki = (): PartyMember => ({
  name: '雪 Yuki',
  class: 'Bard',
  species: 'Gnome',
  hp: 8,
  maxHp: 9,
  stats: { might: 1, magic: 3, mischief: 4 },
  status: 'active',
});

const item = (overrides: Partial<InventoryItem> & Pick<InventoryItem, 'ownerName' | 'name'>): InventoryItem => ({
  description: 'A well-used adventuring tool.',
  statBonuses: {},
  ...overrides,
});

const momentum = (overrides: Partial<SceneMomentum>): SceneMomentum => ({
  directive: 'press_current_scene',
  staleChoiceCount: 0,
  turnsSinceSceneChange: 1,
  turnsSinceCombat: 4,
  justCompletedCombat: false,
  justCompletedDifficultChallenge: false,
  suggestedNextBeat: 'Keep exploring',
  reason: 'fixture',
  ...overrides,
});

const goblinAmbush = (overrides: Partial<EncounterState> = {}): EncounterState => ({
  id: 'enc-goblins',
  name: 'Goblin Ambush',
  status: 'active',
  round: 2,
  objective: 'Drive off the goblin raiders',
  areas: [
    { id: 'area-bridge', label: 'Rope Bridge', description: 'A swaying bridge over a gorge', tags: ['narrow', 'high'] },
    { id: 'area-rocks', label: 'Boulder Pile', description: 'Loose rocks at the gorge edge', tags: ['cover'] },
  ],
  enemies: [
    { id: 'gob-1', name: 'Snag the Goblin Boss', role: 'boss', hp: 9, maxHp: 14, status: 'active', intent: 'Cut the bridge ropes' },
    { id: 'gob-2', name: 'Goblin Slinger', role: 'minion', hp: 3, maxHp: 4, status: 'active' },
    { id: 'gob-3', name: 'Goblin Spearman', role: 'minion', hp: 0, maxHp: 4, status: 'defeated' },
  ],
  ...overrides,
});

const party = (...members: Array<() => PartyMember>): PartyMember[] => members.map(member => member());

const fixture = (
  id: string,
  category: ChoicesFixtureCategory,
  deadline: ChoicesFixture['deadline'],
  expectedFacts: string[],
  build: () => NarrationInput,
): ChoicesFixture => ({ id, category, deadline, expectedFacts, build });

export const MODEL_REFRESH_CHOICES_FIXTURES: readonly ChoicesFixture[] = [
  // ---- Ordinary deadline (15) ----
  fixture('explore-corridor', 'exploration', 'ordinary', [
    'Next actor is Finn Quickcrust (Rogue); top stat mischief',
    'No encounter is active; no enemies exist yet',
  ], () => ({
    ...baseInput(),
    scene: 'A dripping sewer tunnel beneath Breadcrumb Town',
    party: party(brom, finn, zara),
    actingCharacterName: 'Brom Ironbread',
    nextCharacterName: 'Finn Quickcrust',
    actionAttempt: 'Pry open the rusty grate',
    actionResult: { success: true, statUsed: 'might', roll: 14, total: 19, summary: 'Brom wrenches the grate free.' },
    recentHistory: ['The party followed muddy footprints into the sewers.'],
    sceneMomentum: momentum({}),
  })),
  fixture('explore-library', 'exploration', 'ordinary', [
    'Next actor is Zara Spellsworth (Wizard); top stat magic',
    'The glowing book is on a pedestal, not yet taken',
  ], () => ({
    ...baseInput(),
    scene: 'A silent library with floating candles and a glowing book on a pedestal',
    party: party(finn, zara, mira),
    actingCharacterName: 'Finn Quickcrust',
    nextCharacterName: 'Zara Spellsworth',
    actionAttempt: 'Check the floor for traps',
    actionResult: { success: false, statUsed: 'mischief', roll: 5, total: 10, summary: 'Finn finds nothing, but a floorboard creaks loudly.' },
    recentHistory: ['The librarian ghost asked the party to be quiet.'],
  })),
  fixture('explore-unicode-forest', 'exploration', 'ordinary', [
    'Next actor is Søren Ælfwine (Ranger); top stat might',
    'Names must round-trip with Unicode characters intact',
  ], () => ({
    ...baseInput(),
    scene: 'A frosty birch forest where the trees whisper in riddles',
    party: party(yuki, soren),
    actingCharacterName: '雪 Yuki',
    nextCharacterName: 'Søren Ælfwine',
    actionAttempt: 'Sing a song back to the whispering trees',
    actionResult: { success: true, statUsed: 'mischief', roll: 16, total: 20, impact: 'strong', summary: 'The trees giggle and reveal a hidden path.' },
    recentHistory: ['The party lost the trail in the snow.'],
  })),
  fixture('explore-cinematic-long-context', 'exploration', 'ordinary', [
    'Next actor is Mira Warmheal (Cleric); top stat magic',
    'Lantern Festival is tonight; the mayor is missing',
  ], () => ({
    ...baseInput(),
    scene: 'The town square during preparations for the Lantern Festival',
    storySummary: 'The party arrived in Breadcrumb Town, learned the mayor vanished before the Lantern Festival, found his hat near the old well, and heard rumors of a lantern thief who only steals blue lanterns. The baker, Old Dunmore, suspects the traveling puppeteer.',
    party: party(brom, zara, finn, mira),
    actingCharacterName: 'Finn Quickcrust',
    nextCharacterName: 'Mira Warmheal',
    actionAttempt: 'Question the traveling puppeteer',
    actionResult: { success: true, statUsed: 'mischief', roll: 12, total: 17, summary: 'The puppeteer nervously admits he saw the mayor near the well.' },
    recentHistory: [
      'Brom helped hang lanterns across the square.',
      'Zara noticed one blue lantern flickering strangely.',
      'Finn followed the puppeteer to his wagon.',
    ],
    gameMode: 'cinematic',
  })),
  fixture('combat-active-bridge', 'combat', 'ordinary', [
    'Goblin Ambush is active; Goblin Spearman is already defeated',
    'Next actor is Brom Ironbread (Fighter); top stat might',
    'Snag intends to cut the bridge ropes',
  ], () => ({
    ...baseInput(),
    scene: 'A rope bridge over a misty gorge',
    party: party(brom, zara, finn),
    actingCharacterName: 'Zara Spellsworth',
    nextCharacterName: 'Brom Ironbread',
    actionAttempt: 'Cast a light spell to blind the goblins',
    actionResult: { success: true, statUsed: 'magic', roll: 15, total: 20, summary: 'The goblins shield their eyes.' },
    recentHistory: ['Goblins leapt out from behind the boulders.'],
    encounterState: goblinAmbush(),
    sceneMomentum: momentum({ directive: 'close_combat', turnsSinceCombat: 0 }),
  })),
  fixture('combat-boss-low-hp', 'combat', 'ordinary', [
    'Snag the Goblin Boss is at 2 of 14 hp; both minions are defeated',
    'Next actor is Finn Quickcrust (Rogue); top stat mischief',
  ], () => ({
    ...baseInput(),
    scene: 'A rope bridge over a misty gorge',
    party: party(brom, finn),
    actingCharacterName: 'Brom Ironbread',
    nextCharacterName: 'Finn Quickcrust',
    actionAttempt: 'Charge Snag with a shield bash',
    actionResult: { success: true, statUsed: 'might', roll: 18, total: 23, impact: 'strong', summary: 'Snag staggers to the edge of the bridge.' },
    recentHistory: ['Finn knocked the slinger into the river.'],
    encounterState: goblinAmbush({
      round: 4,
      enemies: [
        { id: 'gob-1', name: 'Snag the Goblin Boss', role: 'boss', hp: 2, maxHp: 14, status: 'active', intent: 'Flee across the bridge' },
        { id: 'gob-2', name: 'Goblin Slinger', role: 'minion', hp: 0, maxHp: 4, status: 'defeated' },
        { id: 'gob-3', name: 'Goblin Spearman', role: 'minion', hp: 0, maxHp: 4, status: 'defeated' },
      ],
    }),
  })),
  fixture('combat-just-resolved', 'combat', 'ordinary', [
    'The Goblin Ambush was just resolved; no enemy is still fighting',
    'Snag was defeated; choices must not treat him as an active threat',
    'Next actor is Zara Spellsworth (Wizard); top stat magic',
  ], () => ({
    ...baseInput(),
    scene: 'The far side of the rope bridge, quiet after the fight',
    party: party(brom, zara),
    actingCharacterName: 'Brom Ironbread',
    nextCharacterName: 'Zara Spellsworth',
    actionAttempt: 'Knock Snag off his feet',
    actionResult: { success: true, statUsed: 'might', roll: 17, total: 22, summary: 'Snag tumbles and surrenders his sack.' },
    recentHistory: ['The party fought goblins on the rope bridge.'],
    encounterState: goblinAmbush({ status: 'defeated', round: 5, lastResolvedEnemyName: 'Snag the Goblin Boss' }),
    encounterJustResolved: true,
    resolvedEncounterEnemyNames: ['Snag the Goblin Boss', 'Goblin Slinger', 'Goblin Spearman'],
    encounterLootHint: 'A sack of stolen blue lanterns',
    sceneMomentum: momentum({ directive: 'victory_exit', justCompletedCombat: true, turnsSinceCombat: 0 }),
  })),
  fixture('combat-zug-start', 'combat', 'ordinary', [
    'No encounter is active yet; zug-ma-geddon mode favors a fight starting',
    'Next actor is Søren Ælfwine (Ranger); top stat might',
  ], () => ({
    ...baseInput(),
    scene: 'A troll toll booth on a stone bridge',
    party: party(soren, mira),
    actingCharacterName: 'Mira Warmheal',
    nextCharacterName: 'Søren Ælfwine',
    actionAttempt: 'Politely refuse to pay the toll',
    actionResult: { success: false, statUsed: 'magic', roll: 4, total: 8, summary: 'The troll cracks his knuckles.' },
    recentHistory: ['A troll demanded three shiny buttons as a toll.'],
    gameMode: 'zug-ma-geddon',
  })),
  fixture('trade-merchant', 'trade-loot', 'ordinary', [
    'Finn owns the Grappling Hook; Brom owns the Iron Shield',
    'Next actor is Finn Quickcrust (Rogue); top stat mischief',
    'No purchase has completed yet',
  ], () => ({
    ...baseInput(),
    scene: 'A cluttered market stall run by a talking cat merchant',
    party: party(brom, finn),
    inventory: [
      item({ ownerName: 'Finn Quickcrust', name: 'Grappling Hook', statBonuses: { mischief: 1 }, transferable: true }),
      item({ ownerName: 'Brom Ironbread', name: 'Iron Shield', statBonuses: { might: 1 }, transferable: true }),
    ],
    actingCharacterName: 'Brom Ironbread',
    nextCharacterName: 'Finn Quickcrust',
    actionAttempt: 'Ask the cat merchant what a lantern of true sight costs',
    actionResult: { success: true, statUsed: 'mischief', roll: 11, total: 13, summary: 'The cat names a price: one shiny thing.' },
    recentHistory: ['The party found the Whisker Market.'],
  })),
  fixture('loot-chest', 'trade-loot', 'ordinary', [
    'The chest is open; its contents are not yet assigned to anyone',
    'Next actor is Mira Warmheal (Cleric); top stat magic',
  ], () => ({
    ...baseInput(),
    scene: "An old dragon's nest with a cracked treasure chest",
    party: party(zara, mira),
    inventory: [item({ ownerName: 'Zara Spellsworth', name: 'Wand of Sparks', statBonuses: { magic: 1 }, charges: 2 })],
    actingCharacterName: 'Zara Spellsworth',
    nextCharacterName: 'Mira Warmheal',
    actionAttempt: 'Magically unlock the chest',
    actionResult: { success: true, statUsed: 'magic', roll: 13, total: 18, summary: 'The lock clicks open, revealing glittering coins and a small key.' },
    recentHistory: ['The dragon left for its afternoon nap.'],
  })),
  fixture('heal-downed-ally', 'healing-revival', 'ordinary', [
    'Brom Ironbread is downed at 0 hp; he is not yet revived',
    'Next actor is Mira Warmheal (Cleric); top stat magic',
  ], () => ({
    ...baseInput(),
    scene: 'A collapsed mine tunnel full of dust',
    party: [{ ...brom(), hp: 0, status: 'downed' }, mira(), finn()],
    actingCharacterName: 'Finn Quickcrust',
    nextCharacterName: 'Mira Warmheal',
    actionAttempt: 'Drag Brom out from under the rubble',
    actionResult: { success: true, statUsed: 'might', roll: 12, total: 14, summary: 'Finn pulls Brom free, but he is still unconscious.' },
    recentHistory: ['A cave-in knocked Brom down.'],
  })),
  fixture('heal-potion-owner', 'healing-revival', 'ordinary', [
    'Zara owns one Healing Potion; she is hurt at 3 of 10 hp',
    'Next actor is Zara Spellsworth (Wizard); top stat magic',
  ], () => ({
    ...baseInput(),
    scene: 'A rain-soaked camp after a hard day',
    party: [finn(), { ...zara(), hp: 3 }],
    inventory: [item({ ownerName: 'Zara Spellsworth', name: 'Healing Potion', healValue: 4, consumable: true })],
    actingCharacterName: 'Finn Quickcrust',
    nextCharacterName: 'Zara Spellsworth',
    actionAttempt: 'Build a campfire',
    actionResult: { success: true, statUsed: 'mischief', roll: 10, total: 15, summary: 'A cozy fire crackles to life.' },
    recentHistory: ['Zara was stung by angry bees earlier.'],
  })),
  fixture('stale-previous-labels', 'stale-top-stat', 'ordinary', [
    'Previous choices must not be repeated verbatim',
    'Next actor is Brom Ironbread (Fighter); top stat might',
  ], () => ({
    ...baseInput(),
    scene: 'A crossroads with a signpost pointing in four directions',
    party: party(brom, finn),
    actingCharacterName: 'Finn Quickcrust',
    nextCharacterName: 'Brom Ironbread',
    actionAttempt: 'Read the signpost',
    actionResult: { success: true, statUsed: 'mischief', roll: 9, total: 14, summary: 'One sign points to a castle, another to a swamp.' },
    recentHistory: ['The party left the goblin bridge behind.'],
    previousChoiceLabels: ['Head toward the castle', 'Wade into the swamp', 'Climb the signpost for a better view'],
  })),
  fixture('stale-post-combat-repeat', 'stale-top-stat', 'ordinary', [
    'Combat just ended; previous combat choices are stale',
    'Next actor is Finn Quickcrust (Rogue); top stat mischief',
  ], () => ({
    ...baseInput(),
    scene: 'A smoky tavern cellar after a brawl with rats',
    party: party(finn, mira),
    actingCharacterName: 'Mira Warmheal',
    nextCharacterName: 'Finn Quickcrust',
    actionAttempt: 'Bless the last rat into sleeping',
    actionResult: { success: true, statUsed: 'magic', roll: 15, total: 19, summary: 'The rat yawns and curls up.' },
    recentHistory: ['Giant rats attacked in the cellar.'],
    previousChoiceLabels: ['Swing at the biggest rat', 'Throw cheese as a distraction', 'Cast a light to scare the rats'],
    sceneMomentum: momentum({ justCompletedCombat: true, turnsSinceCombat: 0, staleChoiceCount: 2 }),
  })),
  fixture('top-stat-mischief-bard', 'stale-top-stat', 'ordinary', [
    'Next actor is 雪 Yuki (Bard); top stat mischief must be offered',
  ], () => ({
    ...baseInput(),
    scene: "A noble's masquerade ball",
    party: party(brom, yuki),
    actingCharacterName: 'Brom Ironbread',
    nextCharacterName: '雪 Yuki',
    actionAttempt: 'Dance with the duchess',
    actionResult: { success: false, statUsed: 'might', roll: 6, total: 11, summary: "Brom steps on the duchess's toes." },
    recentHistory: ['The party is hunting a thief hidden among the guests.'],
  })),

  // ---- Relaxed deadline (5) ----
  fixture('relaxed-first-turn', 'exploration', 'relaxed', [
    'First turn of the adventure; nothing has happened yet',
    'Next actor is Brom Ironbread (Fighter); top stat might',
  ], () => ({
    ...baseInput(),
    scene: 'The Breadcrumbs Inn on a stormy evening',
    party: party(zara, brom, finn),
    actingCharacterName: 'Zara Spellsworth',
    nextCharacterName: 'Brom Ironbread',
    actionAttempt: 'Look around the inn',
    actionResult: { success: true, summary: 'The adventure begins.' },
    isFirstTurn: true,
  })),
  fixture('relaxed-first-turn-dm-prep', 'exploration', 'relaxed', [
    'First turn; DM prep says a dragon egg is hidden in the town',
    'Next actor is Søren Ælfwine (Ranger); top stat might',
  ], () => ({
    ...baseInput(),
    scene: 'A lively harbor town at sunrise',
    party: party(yuki, soren),
    actingCharacterName: '雪 Yuki',
    nextCharacterName: 'Søren Ælfwine',
    actionAttempt: 'Arrive in town',
    actionResult: { success: true, summary: 'The adventure begins.' },
    dmPrep: 'A stolen dragon egg is hidden somewhere in the harbor town. The harbor master knows more than he says.',
    isFirstTurn: true,
  })),
  fixture('relaxed-intervention', 'healing-revival', 'relaxed', [
    'A dragon intervention just rescued the party; all heroes were downed',
    'Next actor is Mira Warmheal (Cleric); top stat magic',
  ], () => ({
    ...baseInput(),
    scene: 'A mountain ledge after a friendly dragon swooped in',
    party: [{ ...brom(), hp: 4 }, { ...mira(), hp: 5 }],
    actingCharacterName: 'Brom Ironbread',
    nextCharacterName: 'Mira Warmheal',
    actionAttempt: 'Thank the dragon',
    actionResult: { success: true, summary: 'The dragon nods and flies away.' },
    recentHistory: ['The whole party fell to an avalanche golem.'],
    interventionRescue: true,
  })),
  fixture('relaxed-sanctuary', 'healing-revival', 'relaxed', [
    'The party is recovering in a sanctuary; no threat is present',
    'Next actor is Finn Quickcrust (Rogue); top stat mischief',
  ], () => ({
    ...baseInput(),
    scene: 'A glowing forest shrine that heals weary travelers',
    party: [{ ...finn(), hp: 6 }, { ...zara(), hp: 4 }],
    actingCharacterName: 'Zara Spellsworth',
    nextCharacterName: 'Finn Quickcrust',
    actionAttempt: 'Rest at the shrine',
    actionResult: { success: true, summary: 'Warm light washes over the party.' },
    recentHistory: ['The party barely escaped the haunted mill.'],
    sanctuaryRecovery: true,
  })),
  fixture('relaxed-first-turn-stale-guard', 'stale-top-stat', 'relaxed', [
    'First turn, but previous labels exist from the prior session; they must not repeat',
    'Next actor is Zara Spellsworth (Wizard); top stat magic',
  ], () => ({
    ...baseInput(),
    scene: 'The Breadcrumbs Inn the morning after',
    party: party(finn, zara),
    actingCharacterName: 'Finn Quickcrust',
    nextCharacterName: 'Zara Spellsworth',
    actionAttempt: 'Wake up',
    actionResult: { success: true, summary: 'A new day begins.' },
    previousChoiceLabels: ['Order breakfast', 'Ask the innkeeper for rumors', 'Check the notice board'],
    isFirstTurn: true,
  })),
];
