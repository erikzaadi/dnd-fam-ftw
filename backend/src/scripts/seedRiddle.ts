// Session 10: The Singing Door - paused mid-riddle.
// Showcases: an active riddle on the latest turn in the current (choice-based) format:
// one correct answer choice, one plausible wrong answer, and one non-answer action.
// Use it to try typed answers ("a piano", "the piano!", "not a jailer"), tapping an
// answer, and unrelated actions while a riddle is open. savingsMode=1 so no images are generated.
// Can be run standalone: npx tsx src/scripts/seedRiddle.ts
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import Database, { type Database as DB } from 'libsql';
import { getConfig } from '../config/env.js';
import { StateService } from '../services/stateService.js';
import { deleteSession, seedChar, seedItem, seedTurn, CHOICES_EXPLORE, type SeedChoice } from './seedHelpers.js';

dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '.env'), quiet: true });

export const SESSION_ID = 'seed-session-10';

const CHOICES_HALL: SeedChoice[] = [
  { label: 'Follow the humming down the hall', difficulty: 'easy', stat: 'mischief', difficultyValue: 8 },
  { label: 'Tap the walls for hidden notes', difficulty: 'normal', stat: 'magic', difficultyValue: 12 },
  { label: 'Push the heavy drum aside', difficulty: 'normal', stat: 'might', difficultyValue: 12 },
];

// The latest turn: the door poses a riddle. Shape matches what the choices agent
// produces today (SECTION_CHOICES_RIDDLE): two answers flagged with riddleAnswer and
// riddleCorrect, plus one non-answer action for the next hero.
const CHOICES_RIDDLE: SeedChoice[] = [
  { label: 'Answer: a piano', difficulty: 'normal', stat: 'magic', difficultyValue: 12, riddleAnswer: 'a piano', riddleCorrect: true },
  { label: 'Answer: a jailer', difficulty: 'normal', stat: 'magic', difficultyValue: 12, riddleAnswer: 'a jailer', riddleCorrect: false },
  { label: 'Search the door frame for a hint', difficulty: 'easy', stat: 'mischief', difficultyValue: 8 },
];

export function seed(db: DB): void {
  deleteSession(db, SESSION_ID);
  db.prepare(`INSERT INTO sessions (id, scene, sceneId, displayName, turn, activeCharacterId, tone, difficulty, gameMode, savingsMode, useLocalAI, interventionUsed, rescues_used, game_over, storySummary, dm_prep)
    VALUES (?, 'The Singing Door', 'singing-door-1', 'The Singing Door', 4, 'seed-s10-c2', 'playful and musical', 'easy', 'balanced', 1, 0, 0, 0, 0, ?, NULL)`)
    .run(
      SESSION_ID,
      'The party followed a strange humming into the Conservatory of Echoes, pushed past a runaway drum, and reached a brass door with a painted mouth that only opens for the right answer.',
    );

  seedChar(db, SESSION_ID, 'seed-s10-c1', 'Bramble', 'Bard', 'Halfling', 'Hums when nervous', 1, 3, 4, 9, 10);
  seedChar(db, SESSION_ID, 'seed-s10-c2', 'Wren', 'Wizard', 'Elf', 'Answers questions with questions', 1, 5, 2, 8, 10);
  seedChar(db, SESSION_ID, 'seed-s10-c3', 'Tuck', 'Fighter', 'Dwarf', 'Counts everything out loud', 5, 1, 1, 10, 10);

  seedItem(db, 'seed-s10-c1', 's10-tuning-fork', '🎵 Tuning Fork', 'Rings true near anything musical', null, JSON.stringify({ magic: 1 }), 0, 1);
  seedItem(db, 'seed-s10-c3', 's10-snack', '🥨 Pretzel Snack', 'A salty pick-me-up', 2, null, 1, 1);

  seedTurn(db, SESSION_ID, null,
    'A soft humming drifts out of the Conservatory of Echoes. Inside, every instrument seems to be holding its breath.',
    CHOICES_HALL, null, null, null, null, null, 'normal', null, null, null, 'low');
  seedTurn(db, SESSION_ID, 'seed-s10-c1',
    'Bramble hums along, and the humming answers! It leads the party past rows of sleepy violins to a giant drum rolling back and forth across the hall.',
    CHOICES_EXPLORE, 'Follow the humming down the hall', 'mischief', 1, 14, 4, 'normal', null, 8, 'Bramble matches the tune perfectly.', 'low');
  seedTurn(db, SESSION_ID, 'seed-s10-c3',
    'Tuck plants his boots and shoves the drum aside with a BOOM that shakes dust from the chandeliers. Behind it stands a brass door with a painted mouth. The mouth yawns, clears its throat, and sings: "I have keys but open no locks. I have space but no room. You can play me, but I am not a game. What am I?"',
    CHOICES_RIDDLE, 'Push the heavy drum aside', 'might', 1, 11, 5, 'normal', null, 12, 'Tuck counts to three and pushes.', 'medium');
}

if (process.argv[1]?.endsWith('seedRiddle.ts')) {
  StateService.initialize();
  const db = new Database(path.resolve(getConfig().SQLITE_DB_PATH));
  seed(db);
  db.close();
  console.log(`Seed complete: ${SESSION_ID}`);
}
