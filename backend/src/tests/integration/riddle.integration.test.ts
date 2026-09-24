import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '../../persistence/database.js';
import { riddleRepository } from '../../repositories/riddleRepository.js';
import { StateService } from '../../services/stateService.js';
import { executeTurnAction } from '../../services/turnService.js';
import type { Choice } from '../../types.js';
import { mockGenerateTurn, resetMockNarrationProvider } from './mockNarrationProvider.js';
import { cleanupIntegrationEnvironment, insertSessionState, makeTestSession, setupIntegrationEnvironment, type IntegrationTestPaths } from './testSessionFixtures.js';

vi.mock('../../providers/ai/AiProviderFactory.js', async () => {
  const { createMockNarrationProvider } = await import('./mockNarrationProvider.js');
  return {
    createNarrationProvider: vi.fn(() => createMockNarrationProvider()),
    createChatClientForTier: vi.fn(),
  };
});

vi.mock('../../realtime/sessionEvents.js', () => ({
  broadcastUpdate: vi.fn(),
  broadcastSessionChanged: vi.fn(),
}));

let paths: IntegrationTestPaths;

beforeAll(() => {
  paths = setupIntegrationEnvironment('riddle');
});

beforeEach(() => {
  resetMockNarrationProvider();
});

afterAll(() => {
  cleanupIntegrationEnvironment(paths);
});

const FLAGGED: Choice[] = [
  { label: 'Answer: a river', difficulty: 'normal', stat: 'mischief', difficultyValue: 12, riddleAnswer: 'a river', riddleCorrect: true },
  { label: 'Answer: a shadow', difficulty: 'normal', stat: 'mischief', difficultyValue: 12, riddleAnswer: 'a shadow', riddleCorrect: false },
  { label: 'Ask for a hint', difficulty: 'easy', stat: 'mischief', difficultyValue: 8 },
];

const seedRiddleSession = async (id: string, choices: Choice[] = FLAGGED): Promise<void> => {
  await insertSessionState(makeTestSession({ id, party: [makeTestSession().party[0]], activeCharacterId: 'char-pip' }));
  await StateService.addTurnResult(id, {
    narration: 'Fiddlewick asks, "What runs but never walks?"',
    choices,
    imagePrompt: null,
    imageSuggested: false,
  }, null);
};

const act = (sessionId: string, action: string) => executeTurnAction(sessionId, 'local', { action, statUsed: 'mischief', difficulty: 'normal', difficultyValue: 12 });

const riddleStatuses = (sessionId: string): string[] =>
  (getDb().prepare('SELECT status FROM session_riddles WHERE session_id = ? ORDER BY source_turn_id').all(sessionId) as { status: string }[]).map(r => r.status);

describe('authoritative riddle state', () => {
  it('records the riddle from its flagged answer and marks it solved with the answering turn', async () => {
    await seedRiddleSession('riddle-solved');
    const result = await act('riddle-solved', 'a river');

    expect(result.ok).toBe(true);
    expect(result.ok && result.body.actionAttempt.actionResult).toMatchObject({ success: true, roll: 0, statUsed: 'none' });
    expect(riddleStatuses('riddle-solved')).toEqual(['solved']);
    expect(riddleRepository.getActive('riddle-solved')).toBeNull();

    // Once solved, the same words are an ordinary action with a roll.
    const again = await act('riddle-solved', 'a river');
    expect(again.ok && again.body.actionAttempt.actionResult.roll).toBeGreaterThan(0);
  });

  it('keeps the riddle open after a wrong answer', async () => {
    await seedRiddleSession('riddle-wrong');
    const result = await act('riddle-wrong', 'The answer is a shadow');

    expect(result.ok && result.body.actionAttempt.actionResult).toMatchObject({ success: false, roll: 0, statUsed: 'none' });
    expect(riddleStatuses('riddle-wrong')).toEqual(['active']);
  });

  it('sends an unclear answer back without consuming the turn or rolling', async () => {
    await seedRiddleSession('riddle-unclear');
    const result = await act('riddle-unclear', 'not a shadow');

    expect(result).toMatchObject({ ok: false, status: 409, body: { error: 'riddle_unclear' } });
    expect(JSON.stringify(result)).not.toContain('river');
    expect(mockGenerateTurn).not.toHaveBeenCalled();
    expect(await StateService.getTurnHistory('riddle-unclear')).toHaveLength(1);
    expect(riddleStatuses('riddle-unclear')).toEqual(['active']);
  });

  it('never creates an answer from unflagged choices: answer attempts wait, other actions proceed', async () => {
    await seedRiddleSession('riddle-unknown', FLAGGED.map(({ riddleCorrect: _riddleCorrect, ...choice }) => choice));

    const answer = await act('riddle-unknown', 'The answer is a river');
    expect(answer).toMatchObject({ ok: false, status: 409, body: { error: 'riddle_answer_unknown' } });
    expect(await StateService.getTurnHistory('riddle-unknown')).toHaveLength(1);

    const scout = await act('riddle-unknown', 'Pip sneaks around Fiddlewick to look for tracks');
    expect(scout.ok && scout.body.actionAttempt.actionResult.roll).toBeGreaterThan(0);
  });

  it('expires an unanswered riddle once the story has moved well past it', async () => {
    await seedRiddleSession('riddle-expired');
    await act('riddle-expired', 'Pip looks around for tracks');
    expect(riddleStatuses('riddle-expired')).toEqual(['active']);

    getDb().prepare('UPDATE sessions SET turn = turn + 10 WHERE id = ?').run('riddle-expired');
    const late = await act('riddle-expired', 'a river');
    expect(late.ok && late.body.actionAttempt.actionResult.roll).toBeGreaterThan(0);
    expect(riddleStatuses('riddle-expired')).toEqual(['expired']);
  });
});
