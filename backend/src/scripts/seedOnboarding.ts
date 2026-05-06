import type { Database as DB } from 'libsql';
import type { Choice, Impact } from '../types.js';

export const ONBOARDING_TEMPLATE_SESSION_ID = 'onboarding-template';

type SeedChoice = Omit<Choice, 'difficulty' | 'stat'> & { difficulty: string; stat: string };

function seedChar(db: DB, sessionId: string, id: string, name: string, cls: string, species: string, quirk: string, might: number, magic: number, mischief: number, hp: number, maxHp: number, avatarUrl: string) {
  db.prepare('DELETE FROM inventory WHERE characterId = ?').run(id);
  db.prepare('DELETE FROM characters WHERE id = ?').run(id);
  db.prepare(`INSERT INTO characters (id, sessionId, name, class, species, quirk, hp, max_hp, might, magic, mischief, status, avatarUrl)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`)
    .run(id, sessionId, name, cls, species, quirk, hp, maxHp, might, magic, mischief, avatarUrl);
}

function seedItem(db: DB, characterId: string, itemId: string, name: string, description: string, healValue: number | null, statBonuses: string | null, consumable: number, transferable: number) {
  db.prepare(`INSERT INTO inventory (characterId, itemId, name, description, healValue, statBonuses, consumable, transferable)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(characterId, itemId, name, description, healValue, statBonuses, consumable, transferable);
}

function seedTurn(
  db: DB,
  sessionId: string,
  characterId: string | null,
  narration: string,
  choices: SeedChoice[],
  actionAttempt: string | null,
  actionStat: string | null,
  actionSuccess: number | null,
  actionRoll: number | null,
  actionStatBonus: number | null,
  turnType: string = 'normal',
  imageUrl: string | null = null,
  actionDifficultyTarget: number | null = null,
  rollNarration: string | null = null,
  currentTensionLevel: string | null = null,
  actionImpact: Impact | null = null,
) {
  const info = db.prepare(`INSERT INTO turn_history (sessionId, characterId, narration, rollNarration, imagePrompt, imageSuggested, imageUrl, actionAttempt, actionStat, actionSuccess, actionRoll, actionStatBonus, actionImpact, actionDifficultyTarget, turnType, currentTensionLevel)
    VALUES (?, ?, ?, ?, NULL, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(sessionId, characterId, narration, rollNarration, imageUrl, actionAttempt, actionStat, actionSuccess, actionRoll, actionStatBonus, actionImpact, actionDifficultyTarget, turnType, currentTensionLevel);
  const turnId = info.lastInsertRowid;
  for (const c of choices) {
    db.prepare(`INSERT INTO turn_choices (turnId, label, difficulty, stat, difficultyValue, narration, flavor)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(turnId, c.label, c.difficulty, c.stat, c.difficultyValue ?? null, c.narration ?? null, c.flavor ?? null);
  }
}

export function seedOnboarding(db: DB) {
  const S = ONBOARDING_TEMPLATE_SESSION_ID;

  db.prepare('DELETE FROM turn_choices WHERE turnId IN (SELECT id FROM turn_history WHERE sessionId = ?)').run(S);
  db.prepare('DELETE FROM turn_history WHERE sessionId = ?').run(S);
  db.prepare('DELETE FROM inventory WHERE characterId IN (SELECT id FROM characters WHERE sessionId = ?)').run(S);
  db.prepare('DELETE FROM characters WHERE sessionId = ?').run(S);
  db.prepare('DELETE FROM sessions WHERE id = ?').run(S);

  db.prepare(`INSERT INTO sessions (id, scene, sceneId, worldDescription, displayName, turn, activeCharacterId, tone, difficulty, gameMode, savingsMode, useLocalAI, interventionUsed, rescues_used, game_over, storySummary, preview_image_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, ?, ?)`)
    .run(
      S,
      'Tangle Wood - The Goblin Camp',
      'forest-1',
      "A whimsical forest realm where the local inn serves legendary pastries - until a gang of goblin thieves made off with the baker's cart, sourdough starter and all.",
      'A Crumby Situation',
      5,
      'onboard-c1',
      'lighthearted adventure',
      'easy',
      'fast',
      "Your party answered the Breadcrumbs Inn's call for help when goblins stole the baker's cart - including a 40-year-old sourdough starter. Brom cleared the path ('just cardio'), Finn scouted and somehow returned with croissants, Zara dazzled the camp into disarray, and Mira talked the last goblin into voluntary surrender. The cart is recovered. The starter is safe. Gerta is crying happy tears. What happens next is up to you.",
      '/images/onboarding/preview.png',
    );

  seedChar(db, S, 'onboard-c1', 'Brom Ironbread', 'Fighter', 'Human', "Bench-presses boulders for fun, insists it's just cardio", 5, 1, 1, 10, 10, '/images/onboarding/avatar_brom.png');
  seedChar(db, S, 'onboard-c2', 'Finn Quickcrust', 'Rogue', 'Halfling', "Cannot resist stealing a bite of other people's food", 1, 2, 5, 8, 8, '/images/onboarding/avatar_finn.png');
  seedChar(db, S, 'onboard-c3', 'Zara Spellsworth', 'Mage', 'Elf', "Alphabetizes her spell components and gets upset when goblins don't", 1, 5, 1, 7, 7, '/images/onboarding/avatar_zara.png');
  seedChar(db, S, 'onboard-c4', 'Mira Warmheal', 'Cleric', 'Human', 'Heals injuries but always adds "told you so" after', 2, 4, 1, 10, 10, '/images/onboarding/avatar_mira.png');

  seedItem(db, 'onboard-c4', 'onboard-i1', '🧪 Healing Potion', 'Restores 4 HP. Tastes suspiciously like apple juice.', 4, null, 1, 1);
  seedItem(db, 'onboard-c3', 'onboard-i2', '📜 Arcane Crouton', 'A stale bread roll infused with magic. Boosts spells and doubles as a projectile.', null, JSON.stringify({ magic: 2 }), 0, 1);

  // Turn 0: Opening - no action yet
  seedTurn(db, S, null, // scene_inn
    "The Breadcrumbs Inn is in crisis. Gerta the baker stands outside wringing a dishcloth, watching a flour trail disappear into Tangle Wood. \"They took EVERYTHING,\" she wails. \"The cart, the croissants, the sourdough starter - forty years of culture!\" A handwritten sign on the inn door reads: Adventurers Wanted. Must not be allergic to goblins. Three silver and a free pastry on completion. You're in.",
    [
      { label: 'Follow the flour trail into the woods', difficulty: 'easy', stat: 'mischief', difficultyValue: 7, narration: 'A fresh trail of flour never lies.' },
      { label: 'Ask Gerta for more information first', difficulty: 'easy', stat: 'magic', difficultyValue: 6, narration: 'Know your enemy - especially if they stole bread.' },
      { label: 'Head straight in and hit something', difficulty: 'normal', stat: 'might', difficultyValue: 10, narration: 'Sometimes the plan IS the lack of a plan.' },
    ],
    null, null, null, null, null, 'normal', '/images/onboarding/scene_inn.png', null, null, 'low',
  );

  // Turn 1: Brom (Fighter) - might success
  seedTurn(db, S, 'onboard-c1',
    "Brom spots the goblin lookout perched in an oak tree and, rather than waste time climbing, simply grabs the trunk and shakes it like a wet dog drying off. The goblin pinwheels into a bramble bush below. \"Cardio,\" Brom explains to nobody in particular. The path into Tangle Wood is now clear and smells strongly of cinnamon.",
    [
      { label: 'Press on toward the goblin camp', difficulty: 'easy', stat: 'mischief', difficultyValue: 7 },
      { label: 'Tie up the lookout before he recovers', difficulty: 'normal', stat: 'mischief', difficultyValue: 10 },
      { label: 'Question the lookout', difficulty: 'easy', stat: 'magic', difficultyValue: 6 },
    ],
    'Head straight in and hit something', 'might', 1, 15, 5, 'normal', '/images/onboarding/scene_brom.png', 10, '🎲 Technically effective. The goblin did not enjoy it.', 'low',
  );

  // Turn 2: Finn (Rogue) - mischief success
  seedTurn(db, S, 'onboard-c2',
    "Finn slips through the undergrowth in near-total silence. He finds the goblin camp: a ring of tents around Gerta's cart, six goblins arguing loudly over a croissant none of them can figure out how to eat correctly. Finn returns with a full tactical report and, somehow, two croissants. He refuses to elaborate.",
    [
      { label: 'Sneak in and sabotage the camp', difficulty: 'normal', stat: 'mischief', difficultyValue: 11 },
      { label: 'Signal the others to surround the camp', difficulty: 'easy', stat: 'magic', difficultyValue: 7 },
      { label: 'Eat a croissant while planning', difficulty: 'easy', stat: 'mischief', difficultyValue: 5, narration: 'The most important meal before a battle.' },
    ],
    'Follow the flour trail into the woods', 'mischief', 1, 17, 5, 'normal', '/images/onboarding/scene_finn.png', 7, '🎲 Ghostlike. Not even the croissants saw him coming.', 'low',
  );

  // Turn 3: Zara (Mage) - magic success
  seedTurn(db, S, 'onboard-c3',
    "Zara steps into the clearing and fires a Dazzle Burst directly into the camp. The goblins scatter in all directions, briefly convinced the stars have come down specifically to argue with them. \"That,\" Zara announces while organizing the smoke into alphabetical dissipation, \"is an Arcane Dispersal Event. D for Devastating.\" The cart is unguarded. One goblin is still spinning.",
    [
      { label: 'Grab the cart and run', difficulty: 'easy', stat: 'might', difficultyValue: 7 },
      { label: 'Secure the sourdough starter first', difficulty: 'easy', stat: 'mischief', difficultyValue: 6 },
      { label: 'Round up the dazed goblins', difficulty: 'normal', stat: 'mischief', difficultyValue: 10 },
    ],
    'Signal the others to surround the camp', 'magic', 1, 16, 5, 'normal', '/images/onboarding/scene_zara.png', 11, '🎲 Textbook casting. Goblins are terrible at astronomy anyway.', 'low',
  );

  // Turn 4: Mira (Cleric) - magic/social success
  seedTurn(db, S, 'onboard-c4',
    "One goblin remains - the smallest of the lot, wearing a croissant as a hat. Mira kneels to its eye level and explains, at length and with great patience, the concept of consequences. The goblin's lower lip wobbles. It hands over the sourdough starter. It may be crying. \"Told you so,\" says Mira quietly, to no one in particular. The cart is hitched. The starter is safe. Gerta's forty years of culture are going home.",
    [
      { label: "Accept Gerta's reward and celebrate", difficulty: 'easy', stat: 'mischief', difficultyValue: 6, narration: 'A job well done deserves a well-earned pastry.' },
      { label: 'Search the camp for more stolen goods', difficulty: 'normal', stat: 'mischief', difficultyValue: 10, narration: 'Goblins always hide the good stuff.' },
      { label: 'Follow the goblins to find who sent them', difficulty: 'hard', stat: 'might', difficultyValue: 14, narration: 'Organised goblin theft smells like something bigger.' },
    ],
    'Ask Gerta for more information first', 'magic', 1, 13, 4, 'normal', '/images/onboarding/scene_mira.png', 6, '🎲 Diplomatic masterclass. The goblin was not a hardened criminal.', 'low',
  );
}
