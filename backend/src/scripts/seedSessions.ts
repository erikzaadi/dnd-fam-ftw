/**
 * Seed orchestrator: runs all session seed modules in order.
 * Idempotent - each module drops and recreates its session.
 * Run from backend/: npx tsx src/scripts/seedSessions.ts
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'libsql';
import { getConfig } from '../config/env.js';
import { StateService } from '../services/stateService.js';
import { seed as seedS1, SESSION_ID as S1 } from './seedSession1.js';
import { seed as seedS2, SESSION_ID as S2 } from './seedSession2.js';
import { seed as seedS3, SESSION_ID as S3 } from './seedSession3.js';
import { seed as seedS4, SESSION_ID as S4 } from './seedSession4.js';
import { seed as seedS5, SESSION_ID as S5 } from './seedSession5.js';
import { seed as seedS6, SESSION_ID as S6 } from './seedSession6.js';
import { seed as seedMechanics, MECHANICS_SHOWCASE_SESSION_ID as S7 } from './seedMechanicsShowcase.js';
import { seed as seedOnboard, ONBOARDING_TEMPLATE_SESSION_ID as S8 } from './seedOnboarding.js';

dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '.env'), quiet: true });

StateService.initialize();

const db = new Database(path.resolve(getConfig().SQLITE_DB_PATH));

const seeds = [seedS1, seedS2, seedS3, seedS4, seedS5, seedS6, seedMechanics, seedOnboard];
for (const seedFn of seeds) {
  seedFn(db);
}

console.log('Seed complete:');
console.log(`  Session 1 (${S1}): The Goblin King's Lair - 4 chars, 7 turns`);
console.log(`  Session 2 (${S2}): Dragon's Peak - 4 chars, 10 turns (intervention + sanctuary)`);
console.log(`  Session 3 (${S3}): The Merchant's Mystery - 4 chars, 6 turns`);
console.log(`  Session 4 (${S4}): ZUG-MA-GEDDON - The Endless Arena - 3 chars, 5 turns`);
console.log(`  Session 5 (${S5}): The Shattered Crown - 4 chars, 4 turns (DM prep + intrigue)`);
console.log(`  Session 6 (${S6}): The Tomb of Endless Dark - 4 chars, 13 turns (GAME OVER - hard, 1 rescue used)`);
console.log(`  Session 7 (${S7}): Mechanics Showcase - 4 chars, 4 turns`);
console.log(`  Session 8 (${S8}): A Crumby Situation - 4 chars, 5 pre-played turns (onboarding template)`);
