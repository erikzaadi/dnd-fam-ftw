// Session 8: A Crumby Situation - the onboarding template cloned for every quick-start session.
// Showcases: pre-generated avatar images, worldDescription, dm_prep + dm_prep_encounters, lighthearted/easy/fast settings, a complete 5-turn arc with one character per turn.
// This session is never played directly - sessionRepository.cloneOnboardingSession() copies it into a new namespace-scoped session.
import type { Database as DB } from 'libsql';
import { deleteSession, seedChar, seedItem, seedTurn } from './seedHelpers.js';

export const ONBOARDING_TEMPLATE_SESSION_ID = 'seed-onboarding-template';

const DM_PREP = `CAMPAIGN: A Crumby Situation

PREMISE: Gerta the baker's legendary sourdough starter - forty years old - was stolen by goblin thieves along with her entire cart. The party must recover it before the starter dies. The goblins are mischievous but not cruel, and something is nudging them toward bolder crimes.

TONE: Warm, silly, and safe. Danger feels cartoonish. Goblins trip over themselves. Pastry is a recurring motif. Avoid anything scary or grim.

VILLAIN: Chief Nubbin, a goblin who found a Cursed Recipe Scroll that whispers increasingly ambitious heist ideas. He is not evil - just easily influenced and very proud of his new scroll. The scroll is the real problem.

RECURRING NPCS:
- Gerta the Baker: warm, dramatic, cries happy tears when bread is returned. Rewards the party with legendary pastries and heartfelt gratitude.
- Pip the Lookout Goblin: the smallest goblin, easily befriended. Willing to lead the party to Nubbin if treated kindly.

FACTIONS:
- The Breadcrumbs Inn: the local community hub - friendly ally, grateful when the starter is returned.
- Nubbin's Goblin Gang: mischievous thieves led by a scroll-obsessed chief - can be reasoned with.

LOCATIONS:
- Tangle Wood Clearing: goblin camp around Gerta's cart. Obstacle: six goblins arguing over croissants. Clue: the cursed scroll sits in Nubbin's tent.
- Breadcrumbs Inn: safe starting hub. Gerta waits here. Notable: she knows every goblin in the wood by name.
- The Old Mill Trail: forest path. Obstacle: a rickety bridge the goblins rigged with a trip-rope. Notable: leads directly to Nubbin's hidden stash.

SETUP/PAYOFF:
- The sourdough starter (found in the cart) unlocks Gerta's gratitude and a legendary pastry reward.
- Pip the lookout (found guarding the perimeter) can guide the party past the rigged bridge if befriended.

SECRETS:
- The Cursed Recipe Scroll was not made by goblins - it was lost by a traveling wizard who wants it back.
- Chief Nubbin can read (unusual for goblins) and is secretly embarrassed about stealing bread.
- Gerta has been bribing the goblins with leftover pastry for years - this is actually a breakup.

ENCOUNTERS:
- Combat: goblin camp defense - six startled goblins throwing bread rolls and tripping over each other.
- Exploration: rigged bridge over the creek - trip-rope, wobbling planks, one very smug goblin watching from a tree.
- Social: convincing Chief Nubbin to give back the scroll - he is proud but not unreasonable.
- Magical/Weird: the scroll whispers a new recipe mid-encounter - "steal the moon."

TREASURE:
- Gerta's legendary cinnamon rolls (restores 3 HP and grants a warm mood buff).
- The Cursed Recipe Scroll (dangerous, funny, and highly portable).

STAGES: Early - recover the cart and starter | Mid - find Nubbin and the scroll | Climax - decide what to do with the scroll
DM NOTE: Always let players succeed in funny ways. If they fail, something sillier happens instead. Every setback should produce a pastry.`;

const ORIGIN_STORY = `Before the Breadcrumbs Inn hung its first help-wanted sign, four wanderers happened to share a table on a rainy evening.

Brom Ironbread, a Human Fighter who benchpresses boulders and calls it cardio, had spent the afternoon carrying a stuck merchant wagon uphill because the oxen looked tired. Finn Quickcrust, a Halfling Rogue with a talent for going entirely unnoticed and an equally impressive talent for appearing just as someone else's food arrives, occupied a corner seat - or possibly had always been there. Zara Spellsworth, an Elf Mage who alphabetizes her spell components by syllable count and gets visibly upset when other people do not, arrived at the precise moment she had calculated dinner would be ready. And Mira Warmheal, a Human Cleric who can close any wound in under a minute but will always say told you so before picking up the bandage, had just finished treating a cart horse with a sore hoof.

That evening Gerta the baker placed a plate of legendary cinnamon rolls on their table without being asked. By the time the plate was empty, none of them could quite explain why they had agreed to help each other out if things ever got interesting.

Things got interesting the next morning. Gerta burst in at dawn, dishcloth clenched in both hands. Her cart was gone. Her croissants were gone. And her sourdough starter - forty years of living culture passed down from her grandmother - was gone with them. A trail of flour led from the inn door straight into the depths of Tangle Wood, and a hand-painted sign had appeared on the doorpost: Adventurers Wanted. Must not be allergic to goblins. Three silver and a free pastry on completion.

Brom cracked his knuckles. Finn sipped the last of his tea and said nothing, which meant yes. Zara opened a small notebook and confirmed that goblin recovery operations fell under the heading of Field Research. Mira tied back her sleeves.

Whatever was waiting at the end of that flour trail did not know it was about to have a very bad morning.`;

const DM_PREP_IMAGE_BRIEF = 'mischievous goblins in a forest clearing, stolen bread cart, glowing recipe scroll, sourdough jar, croissant chaos, whimsical Tangle Wood, cozy inn, small goblin chief';

const DM_PREP_ENCOUNTERS = JSON.stringify([
  {
    name: 'Goblin Camp Defense',
    triggerHint: 'when party enters the goblin camp clearing',
    enemies: [
      { name: 'Goblin Thief', role: 'minion', weaknesses: [{ label: 'distraction or noise', school: 'mind' }], traits: ['easily startled', 'throws bread rolls'] },
      { name: 'Chief Nubbin', role: 'boss', weaknesses: [{ label: 'kindness or flattery', school: 'mind' }], traits: ['scroll-obsessed', 'proud but not cruel', 'can be reasoned with'] },
    ],
    areas: [
      { label: 'Tangle Wood Clearing', tags: ['forest', 'open', 'goblin tents'] },
      { label: "Nubbin's Tent", tags: ['interior', 'cramped', 'scroll on table'] },
    ],
    objective: 'Recover the sourdough starter and the cursed scroll without anyone getting badly hurt',
    lootHint: "Gerta's legendary cinnamon rolls and the Cursed Recipe Scroll",
  },
  {
    name: 'Rigged Bridge Crossing',
    triggerHint: "when party follows the Old Mill Trail toward Nubbin's stash",
    enemies: [
      { name: 'Smug Lookout Goblin', role: 'hazard', weaknesses: [{ label: 'treat or bribe', school: 'mind' }], traits: ['controls the trip-rope', 'laughs at falling'] },
    ],
    areas: [{ label: 'Rickety Creek Bridge', tags: ['narrow', 'rigged trap', 'creek below'] }],
    objective: 'Cross the bridge without triggering the trip-rope',
  },
]);

export function seed(db: DB): void {
  const S = ONBOARDING_TEMPLATE_SESSION_ID;

  deleteSession(db, S);

  db.prepare(`INSERT INTO sessions (id, scene, sceneId, worldDescription, displayName, turn, activeCharacterId, tone, difficulty, gameMode, savingsMode, useLocalAI, interventionUsed, rescues_used, game_over, storySummary, preview_image_url, dm_prep, dm_prep_image_brief, dm_prep_encounters, origin_story)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, ?, ?, ?, ?, ?, ?)`)
    .run(
      S,
      'Tangle Wood - The Goblin Camp',
      'forest-1',
      "A whimsical forest realm where the local inn serves legendary pastries - until a gang of goblin thieves made off with the baker's cart, sourdough starter and all.",
      'A Crumby Situation',
      5,
      'seed-onboard-c1',
      'lighthearted adventure',
      'easy',
      'fast',
      "Your party answered the Breadcrumbs Inn's call for help when goblins stole the baker's cart - including a 40-year-old sourdough starter. Brom cleared the path ('just cardio'), Finn scouted and somehow returned with croissants, Zara dazzled the camp into disarray, and Mira talked the last goblin into voluntary surrender. The cart is recovered. The starter is safe. Gerta is crying happy tears. What happens next is up to you.",
      '/images/onboarding/preview.png',
      DM_PREP,
      DM_PREP_IMAGE_BRIEF,
      DM_PREP_ENCOUNTERS,
      ORIGIN_STORY,
    );

  seedChar(db, S, 'seed-onboard-c1', 'Brom Ironbread', 'Fighter', 'Human', "Bench-presses boulders for fun, insists it's just cardio", 5, 1, 1, 10, 10, 'active', '/images/onboarding/avatar_brom.png');
  seedChar(db, S, 'seed-onboard-c2', 'Finn Quickcrust', 'Rogue', 'Halfling', "Cannot resist stealing a bite of other people's food", 1, 2, 5, 8, 8, 'active', '/images/onboarding/avatar_finn.png');
  seedChar(db, S, 'seed-onboard-c3', 'Zara Spellsworth', 'Mage', 'Elf', "Alphabetizes her spell components and gets upset when goblins don't", 1, 5, 1, 7, 7, 'active', '/images/onboarding/avatar_zara.png');
  seedChar(db, S, 'seed-onboard-c4', 'Mira Warmheal', 'Cleric', 'Human', 'Heals injuries but always adds "told you so" after', 2, 4, 1, 10, 10, 'active', '/images/onboarding/avatar_mira.png');

  seedItem(db, 'seed-onboard-c4', 'seed-onboard-i1', '🧪 Healing Potion', 'Restores 4 HP. Tastes suspiciously like apple juice.', 4, null, 1, 1);
  seedItem(db, 'seed-onboard-c3', 'seed-onboard-i2', '📜 Arcane Crouton', 'A stale bread roll infused with magic. Boosts spells and doubles as a projectile.', null, JSON.stringify({ magic: 2 }), 0, 1);

  seedTurn(db, S, null,
    "The Breadcrumbs Inn is in crisis. Gerta the baker stands outside wringing a dishcloth, watching a flour trail disappear into Tangle Wood. \"They took EVERYTHING,\" she wails. \"The cart, the croissants, the sourdough starter - forty years of culture!\" A handwritten sign on the inn door reads: Adventurers Wanted. Must not be allergic to goblins. Three silver and a free pastry on completion. You're in.",
    [
      { label: 'Follow the flour trail into the woods', difficulty: 'easy', stat: 'mischief', difficultyValue: 7, narration: 'A fresh trail of flour never lies.' },
      { label: 'Ask Gerta for more information first', difficulty: 'easy', stat: 'magic', difficultyValue: 6, narration: 'Know your enemy - especially if they stole bread.' },
      { label: 'Head straight in and hit something', difficulty: 'normal', stat: 'might', difficultyValue: 10, narration: 'Sometimes the plan IS the lack of a plan.' },
    ],
    null, null, null, null, null, 'normal', '/images/onboarding/scene_inn.png', null, null, 'low',
  );

  seedTurn(db, S, 'seed-onboard-c1',
    "Brom spots the goblin lookout perched in an oak tree and, rather than waste time climbing, simply grabs the trunk and shakes it like a wet dog drying off. The goblin pinwheels into a bramble bush below. \"Cardio,\" Brom explains to nobody in particular. The path into Tangle Wood is now clear and smells strongly of cinnamon.",
    [
      { label: 'Press on toward the goblin camp', difficulty: 'easy', stat: 'mischief', difficultyValue: 7 },
      { label: 'Tie up the lookout before he recovers', difficulty: 'normal', stat: 'mischief', difficultyValue: 10 },
      { label: 'Question the lookout', difficulty: 'easy', stat: 'magic', difficultyValue: 6 },
    ],
    'Head straight in and hit something', 'might', 1, 15, 5, 'normal', '/images/onboarding/scene_brom.png', 10, '🎲 Technically effective. The goblin did not enjoy it.', 'low',
  );

  seedTurn(db, S, 'seed-onboard-c2',
    "Finn slips through the undergrowth in near-total silence. He finds the goblin camp: a ring of tents around Gerta's cart, six goblins arguing loudly over a croissant none of them can figure out how to eat correctly. Finn returns with a full tactical report and, somehow, two croissants. He refuses to elaborate.",
    [
      { label: 'Sneak in and sabotage the camp', difficulty: 'normal', stat: 'mischief', difficultyValue: 11 },
      { label: 'Signal the others to surround the camp', difficulty: 'easy', stat: 'magic', difficultyValue: 7 },
      { label: 'Eat a croissant while planning', difficulty: 'easy', stat: 'mischief', difficultyValue: 5, narration: 'The most important meal before a battle.' },
    ],
    'Follow the flour trail into the woods', 'mischief', 1, 17, 5, 'normal', '/images/onboarding/scene_finn.png', 7, '🎲 Ghostlike. Not even the croissants saw him coming.', 'low',
  );

  seedTurn(db, S, 'seed-onboard-c3',
    "Zara steps into the clearing and fires a Dazzle Burst directly into the camp. The goblins scatter in all directions, briefly convinced the stars have come down specifically to argue with them. \"That,\" Zara announces while organizing the smoke into alphabetical dissipation, \"is an Arcane Dispersal Event. D for Devastating.\" The cart is unguarded. One goblin is still spinning.",
    [
      { label: 'Grab the cart and run', difficulty: 'easy', stat: 'might', difficultyValue: 7 },
      { label: 'Secure the sourdough starter first', difficulty: 'easy', stat: 'mischief', difficultyValue: 6 },
      { label: 'Round up the dazed goblins', difficulty: 'normal', stat: 'mischief', difficultyValue: 10 },
    ],
    'Signal the others to surround the camp', 'magic', 1, 16, 5, 'normal', '/images/onboarding/scene_zara.png', 11, '🎲 Textbook casting. Goblins are terrible at astronomy anyway.', 'low',
  );

  seedTurn(db, S, 'seed-onboard-c4',
    "One goblin remains - the smallest of the lot, wearing a croissant as a hat. Mira kneels to its eye level and explains, at length and with great patience, the concept of consequences. The goblin's lower lip wobbles. It hands over the sourdough starter. It may be crying. \"Told you so,\" says Mira quietly, to no one in particular. The cart is hitched. The starter is safe. Gerta's forty years of culture are going home.",
    [
      { label: "Accept Gerta's reward and celebrate", difficulty: 'easy', stat: 'mischief', difficultyValue: 6, narration: 'A job well done deserves a well-earned pastry.' },
      { label: 'Search the camp for more stolen goods', difficulty: 'normal', stat: 'mischief', difficultyValue: 10, narration: 'Goblins always hide the good stuff.' },
      { label: 'Follow the goblins to find who sent them', difficulty: 'hard', stat: 'might', difficultyValue: 14, narration: 'Organised goblin theft smells like something bigger.' },
    ],
    'Ask Gerta for more information first', 'magic', 1, 13, 4, 'normal', '/images/onboarding/scene_mira.png', 6, '🎲 Diplomatic masterclass. The goblin was not a hardened criminal.', 'low',
  );
}

// Alias for backward compatibility with any direct callers
export const seedOnboarding = seed;
