// Session 9: The Lantern Thief - a completed one-evening adventure.
// Showcases: adventure lifecycle end state (format one_evening, status completed,
// resolution success), a public chapter objective, a finale won by a successful roll,
// and a conclusion turn with no choices, so the ending screen and Continue this world
// can be tried without playing a whole evening.
import type { Database as DB } from 'libsql';
import { serializeArc } from '../services/adventureLifecycleService.js';
import { deleteSession, seedChar, seedItem, seedTurn, CHOICES_EXPLORE, CHOICES_SOCIAL, type SeedChoice } from './seedHelpers.js';

export const SESSION_ID = 'seed-session-9';

const OBJECTIVE = 'Catch the lantern thief before the Festival of Lights is ruined tonight.';

const CHOICES_FINALE: SeedChoice[] = [
  { label: 'Snatch the Moon Lantern from Mothwick', difficulty: 'normal', stat: 'mischief', difficultyValue: 12 },
  { label: 'Talk Mothwick down from the bell tower', difficulty: 'normal', stat: 'magic', difficultyValue: 12 },
  { label: 'Climb the tower and block the escape', difficulty: 'hard', stat: 'might', difficultyValue: 15 },
];

export function seed(db: DB): void {
  deleteSession(db, SESSION_ID);
  db.prepare(`INSERT INTO sessions (id, scene, sceneId, displayName, turn, activeCharacterId, tone, difficulty, gameMode, savingsMode, useLocalAI, interventionUsed, rescues_used, game_over, storySummary, dm_prep, adventure_format, adventure_status, adventure_objective, adventure_plan)
    VALUES (?, 'The Old Bell Tower', 'tower-1', 'The Lantern Thief', 7, 'seed-s9-c1', 'cozy and mischievous', 'easy', 'balanced', 0, 0, 0, 0, 0, ?, ?, 'one_evening', 'completed', ?, ?)`)
    .run(
      SESSION_ID,
      'The party tracked a lantern thief through Willowmere on festival night, followed a trail of glowing moth dust to the old bell tower, and recovered the Moon Lantern from Mothwick the moth-sprite just before the festival began.',
      'PREMISE: Someone is stealing the festival lanterns of Willowmere. TONIGHT\'S OBJECTIVE: Catch the lantern thief before the Festival of Lights is ruined tonight. TONIGHT\'S PAYOFF: The moth dust clue leads to the bell tower; Mothwick only wanted light for her lost siblings.',
      OBJECTIVE,
      'Mothwick only wanted light for her lost siblings; the moth dust clue from the market leads to the bell tower.',
    );

  seedChar(db, SESSION_ID, 'seed-s9-c1', 'Pip Quickfingers', 'Rogue', 'Halfling', 'Pockets things out of politeness', 1, 2, 5, 7, 8);
  seedChar(db, SESSION_ID, 'seed-s9-c2', 'Bramble', 'Druid', 'Firbolg', 'Apologizes to every plant they step on', 3, 4, 1, 9, 10);

  seedItem(db, 'seed-s9-c1', 's9-i1', '🏮 Moon Lantern', 'The festival\'s brightest lantern, returned by the party', null, JSON.stringify({ magic: 1 }), 0, 1);

  seedTurn(db, SESSION_ID, null, 'Willowmere glows with paper lanterns on festival night, but one by one they are going dark. The mayor wrings her hands: the Moon Lantern itself has vanished, and the festival starts at midnight. Catch the lantern thief before the Festival of Lights is ruined tonight.', CHOICES_EXPLORE, null, null, null, null, null);
  seedTurn(db, SESSION_ID, 'seed-s9-c1', 'Pip inspects the empty lantern hooks and finds a sparkle of silver moth dust. It drifts in a faint trail toward the old bell tower.', CHOICES_EXPLORE, 'Search the market stalls for clues', 'mischief', 1, 15, 5, 'normal', null, 10, null, 'low');
  seedTurn(db, SESSION_ID, 'seed-s9-c2', 'Bramble asks the festival ivy what it saw. The ivy, flattered to be asked, whispers of a tiny winged figure carrying something far too bright for her size.', CHOICES_SOCIAL, 'Ask the plants what they saw', 'magic', 1, 13, 4, 'normal', null, 10, null, 'medium');
  seedTurn(db, SESSION_ID, 'seed-s9-c1', 'The trail ends at the bell tower. At the very top, a moth-sprite named Mothwick clutches the Moon Lantern and hisses at them. This is the moment: the festival bells will ring any minute.', CHOICES_FINALE, 'Follow the moth dust to the tower', 'mischief', 1, 12, 5, 'normal', null, 11, null, 'high');
  seedTurn(db, SESSION_ID, 'seed-s9-c2', 'Bramble kneels and speaks softly. Mothwick admits she only wanted light to find her lost siblings. Bramble promises the festival will shine for them too, and the sprite loosens her grip.', CHOICES_FINALE, 'Talk Mothwick down from the bell tower', 'magic', 1, 17, 4, 'strong', null, 12, null, 'high');
  seedTurn(db, SESSION_ID, 'seed-s9-c1', 'Pip darts in, catches the Moon Lantern mid-wobble, and hands it straight back to Mothwick to hold for one last glowing moment before carrying it down together.', [], 'Snatch the Moon Lantern from Mothwick', 'mischief', 1, 19, 5, 'strong', null, 12, null, 'medium');

  seedTurn(db, SESSION_ID, null, 'The Moon Lantern rises over Willowmere just as the bells ring midnight, and the whole valley glows silver. Bramble kept a promise to a frightened moth-sprite, and now dozens of tiny moths dance around the square, Mothwick\'s siblings found at last. Pip returned the lantern and, for once, returned everything else in his pockets too (mostly). The mayor declared them honorary lamplighters, a title Pip immediately misspelled on a napkin. Somewhere a bard is already getting the details wrong.', [], null, null, null, null, null, 'conclusion', null, null, null, 'low');

  const conclusionTurnId = (db.prepare('SELECT MAX(id) AS id FROM turn_history WHERE sessionId = ?').get(SESSION_ID) as { id: number }).id;
  db.prepare('UPDATE sessions SET adventure_arc = ? WHERE id = ?').run(serializeArc({
    chapter: 1,
    phase: 'epilogue',
    // Five player turns; the family asked to wrap up after three, which started the finale.
    playerActionCount: 5,
    budgetStartCount: 0,
    participatingHeroIds: ['seed-s9-c1', 'seed-s9-c2'],
    wrapUpRequested: true,
    finaleStartedAtCount: 3,
    decisiveAttempts: 0,
    resolution: 'success',
    conclusionTurnId,
  }), SESSION_ID);
}
