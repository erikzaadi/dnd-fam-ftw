import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '../../persistence/database.js';
import { riddleRepository } from '../../repositories/riddleRepository.js';
import { operationRepository } from '../../repositories/operationRepository.js';
import { RIDDLE_ABANDONED_NARRATION, recoverRiddle } from '../../services/riddleRecoveryService.js';
import { ensureActiveRiddle } from '../../services/riddleService.js';
import { acceptSessionOperation } from '../../services/sessionOperationService.js';
import { StateService } from '../../services/stateService.js';
import { executeTurnAction } from '../../services/turnService.js';
import type { Choice } from '../../types.js';
import type { NarrationChoice } from '../../providers/ai/narration/NarrationProvider.js';
import { createChatClientForTier } from '../../providers/ai/AiProviderFactory.js';
import { FIXED_NARRATION_OUTPUT, TURN_STRATEGIES, mockProposeMechanics, narratingMock, scriptTurnOutput } from './mockNarrationProvider.js';
import { cleanupIntegrationEnvironment, insertSessionState, makeTestSession, setupIntegrationEnvironment, type IntegrationTestPaths } from './testSessionFixtures.js';

vi.mock('../../providers/ai/AiProviderFactory.js', async () => {
  const { createStagedMockNarrationProvider } = await import('./mockNarrationProvider.js');
  return {
    createNarrationProvider: vi.fn(() => createStagedMockNarrationProvider()),
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
  scriptTurnOutput();
});

afterEach(() => {
  delete process.env.AI_TURN_STRATEGY;
});

afterAll(() => {
  cleanupIntegrationEnvironment(paths);
});

const FLAGGED: NarrationChoice[] = [
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

// Riddle judging happens before any narration call, but a riddle posed by narration
// travels differently per strategy (monolith output vs presentation), so the whole
// suite runs under both.
describe.each(TURN_STRATEGIES)('riddles (%s)', (strategy) => {
  beforeEach(() => {
    process.env.AI_TURN_STRATEGY = strategy;
  });

  describe('authoritative riddle state', () => {
    it('records the riddle from its flagged answer and marks it solved with the answering turn', async () => {
      await seedRiddleSession(`riddle-solved-${strategy}`);
      const result = await act(`riddle-solved-${strategy}`, 'a river');

      expect(result.ok).toBe(true);
      expect(result.ok && result.body.actionAttempt.actionResult).toMatchObject({ success: true, roll: 0, statUsed: 'none' });
      expect(riddleStatuses(`riddle-solved-${strategy}`)).toEqual(['solved']);
      expect(riddleRepository.getActive(`riddle-solved-${strategy}`)).toBeNull();

      // Once solved, the same words are an ordinary action with a roll.
      const again = await act(`riddle-solved-${strategy}`, 'a river');
      expect(again.ok && again.body.actionAttempt.actionResult.roll).toBeGreaterThan(0);
    });

    it('keeps the riddle open after a wrong answer', async () => {
      await seedRiddleSession(`riddle-wrong-${strategy}`);
      const result = await act(`riddle-wrong-${strategy}`, 'The answer is a shadow');

      expect(result.ok && result.body.actionAttempt.actionResult).toMatchObject({ success: false, roll: 0, statUsed: 'none' });
      expect(riddleStatuses(`riddle-wrong-${strategy}`)).toEqual(['active']);
    });

    it('sends an unclear answer back without consuming the turn or rolling', async () => {
      await seedRiddleSession(`riddle-unclear-${strategy}`);
      const result = await act(`riddle-unclear-${strategy}`, 'not a shadow');

      expect(result).toMatchObject({ ok: false, status: 409, body: { error: 'riddle_unclear' } });
      expect(JSON.stringify(result)).not.toContain('river');
      expect(narratingMock(strategy)).not.toHaveBeenCalled();
      expect(mockProposeMechanics).not.toHaveBeenCalled();
      expect(await StateService.getTurnHistory(`riddle-unclear-${strategy}`)).toHaveLength(1);
      expect(riddleStatuses(`riddle-unclear-${strategy}`)).toEqual(['active']);
    });

    it('never creates an answer from unflagged choices: other actions proceed while it is unknown', async () => {
      await seedRiddleSession(`riddle-unknown-scout-${strategy}`, FLAGGED.map(({ riddleCorrect: _riddleCorrect, ...choice }) => choice));

      const scout = await act(`riddle-unknown-scout-${strategy}`, 'Pip sneaks around Fiddlewick to look for tracks');
      expect(scout.ok && scout.body.actionAttempt.actionResult.roll).toBeGreaterThan(0);
      expect(riddleRepository.getActive(`riddle-unknown-scout-${strategy}`)).toMatchObject({ answerKnown: false });
    });

    it('closes an unknown riddle with a DM beat when recovery cannot find the answer', async () => {
      await seedRiddleSession(`riddle-unknown-${strategy}`, FLAGGED.map(({ riddleCorrect: _riddleCorrect, ...choice }) => choice));

      const answer = await act(`riddle-unknown-${strategy}`, 'The answer is a river');
      expect(answer).toMatchObject({ ok: false, status: 409, body: { error: 'riddle_answer_unknown' } });
      expect(narratingMock(strategy)).not.toHaveBeenCalled();
      expect(mockProposeMechanics).not.toHaveBeenCalled();

      await vi.waitFor(() => expect(riddleStatuses(`riddle-unknown-${strategy}`)).toEqual(['abandoned']));
      const history = await StateService.getTurnHistory(`riddle-unknown-${strategy}`);
      expect(history).toHaveLength(2);
      expect(history[1].narration).toBe(RIDDLE_ABANDONED_NARRATION);
      expect(history[1].characterId ?? null).toBeNull();
      expect(history[1].choices.some(c => c.riddleAnswer)).toBe(false);

      // The riddle is gone: the same words are now an ordinary action.
      const after = await act(`riddle-unknown-${strategy}`, 'The answer is a river');
      expect(after.ok && after.body.actionAttempt.actionResult.roll).toBeGreaterThan(0);
    });

    it('waits for a turn that is still resolving before closing the riddle', async () => {
      await seedRiddleSession(`riddle-guard-${strategy}`, FLAGGED.map(({ riddleCorrect: _riddleCorrect, ...choice }) => choice));
      const blocking = acceptSessionOperation({ sessionId: `riddle-guard-${strategy}`, namespaceId: 'local', kind: 'action', payload: { action: 'busy' } });
      expect(blocking.type).toBe('accepted');
      const session = await StateService.getSession(`riddle-guard-${strategy}`);
      const riddle = ensureActiveRiddle(session!);

      const recovering = recoverRiddle(`riddle-guard-${strategy}`, 'local', riddle!);
      await new Promise(resolve => setTimeout(resolve, 300));
      expect(riddleStatuses(`riddle-guard-${strategy}`)).toEqual(['active']);

      operationRepository.fail(blocking.type === 'accepted' ? blocking.operation.id : '', 'test_done', 'done');
      expect(await recovering).toBe('abandoned');
      expect(riddleStatuses(`riddle-guard-${strategy}`)).toEqual(['abandoned']);
    }, 10_000);

    it('fills in the answer when recovery finds it, so the next attempt is judged', async () => {
      await seedRiddleSession(`riddle-recovered-${strategy}`, FLAGGED.map(({ riddleCorrect: _riddleCorrect, ...choice }) => choice));
      const create = vi.fn().mockResolvedValue({ choices: [{ message: { content: '{"canonicalAnswer":"a river","aliases":["river"]}' } }] });
      vi.mocked(createChatClientForTier).mockReturnValue({ client: { chat: { completions: { create } } }, model: 'mock' } as unknown as ReturnType<typeof createChatClientForTier>);

      const first = await act(`riddle-recovered-${strategy}`, 'The answer is a river');
      expect(first).toMatchObject({ ok: false, body: { error: 'riddle_answer_unknown' } });
      await vi.waitFor(() => expect(riddleRepository.getActive(`riddle-recovered-${strategy}`)).toMatchObject({ answerKnown: true, canonicalAnswer: 'a river' }));
      vi.mocked(createChatClientForTier).mockReset();

      const second = await act(`riddle-recovered-${strategy}`, 'The answer is a river');
      expect(second.ok && second.body.actionAttempt.actionResult).toMatchObject({ success: true, roll: 0 });
      expect(await StateService.getTurnHistory(`riddle-recovered-${strategy}`)).toHaveLength(2);
    });

    it('expires an unanswered riddle once the story has moved well past it', async () => {
      await seedRiddleSession(`riddle-expired-${strategy}`);
      await act(`riddle-expired-${strategy}`, 'Pip looks around for tracks');
      expect(riddleStatuses(`riddle-expired-${strategy}`)).toEqual(['active']);

      getDb().prepare('UPDATE sessions SET turn = turn + 10 WHERE id = ?').run(`riddle-expired-${strategy}`);
      const late = await act(`riddle-expired-${strategy}`, 'a river');
      expect(late.ok && late.body.actionAttempt.actionResult.roll).toBeGreaterThan(0);
      expect(riddleStatuses(`riddle-expired-${strategy}`)).toEqual(['expired']);
    });
  });

  describe('riddles posed by narration', () => {
    const ECHO_NARRATION = 'A voice booms: "I speak without a mouth and hear without ears. What am I?"';
    const answerChoices = (sessionId: string) => async () => {
      const history = await StateService.getTurnHistory(sessionId);
      return history[history.length - 1].choices.filter(c => c.riddleAnswer);
    };
    const plainSession = async (id: string) => {
      await insertSessionState(makeTestSession({ id, party: [makeTestSession().party[0]], activeCharacterId: 'char-pip' }));
    };

    it('records the narrated answer at commit and adds a matching answer choice', async () => {
      await plainSession(`narrated-riddle-${strategy}`);
      scriptTurnOutput({ ...FIXED_NARRATION_OUTPUT, narration: ECHO_NARRATION, narratedRiddle: { canonicalAnswer: 'an echo', aliases: ['echo'] } });

      await act(`narrated-riddle-${strategy}`, 'Pip calls out into the cave');

      expect(riddleRepository.getActive(`narrated-riddle-${strategy}`)).toMatchObject({ source: 'narration', canonicalAnswer: 'an echo', aliases: ['echo'], answerKnown: true });
      const answers = await answerChoices(`narrated-riddle-${strategy}`)();
      expect(answers).toHaveLength(1);
      expect(answers[0]).toMatchObject({ label: 'Answer: an echo', riddleAnswer: 'an echo', riddleCorrect: true });

      scriptTurnOutput();
      const solved = await act(`narrated-riddle-${strategy}`, 'An echo!');
      expect(solved.ok && solved.body.actionAttempt.actionResult).toMatchObject({ success: true, roll: 0 });
      expect(riddleStatuses(`narrated-riddle-${strategy}`)).toEqual(['solved']);
    });

    it('overrides a different answer guessed by the choices agent', async () => {
      await plainSession(`narrated-override-${strategy}`);
      scriptTurnOutput({ ...FIXED_NARRATION_OUTPUT, narration: ECHO_NARRATION, choices: FLAGGED, narratedRiddle: { canonicalAnswer: 'an echo', aliases: [] } });

      await act(`narrated-override-${strategy}`, 'Pip calls out into the cave');

      const answers = await answerChoices(`narrated-override-${strategy}`)();
      expect(answers.find(c => c.riddleCorrect)?.riddleAnswer).toBe('an echo');
      expect(answers.find(c => c.riddleCorrect === false)?.riddleAnswer).toBe('a river');
      // The agent's guessed "correct" answer is now just wrong.
      scriptTurnOutput();
      const wrong = await act(`narrated-override-${strategy}`, 'The answer is a river');
      expect(wrong.ok && wrong.body.actionAttempt.actionResult).toMatchObject({ success: false, roll: 0 });
    });

    it('turns answer choices for a riddle nobody posed into ordinary actions', async () => {
      await plainSession(`orphan-choices-${strategy}`);
      scriptTurnOutput({ ...FIXED_NARRATION_OUTPUT, choices: FLAGGED });

      await act(`orphan-choices-${strategy}`, 'Pip looks around');

      expect(await answerChoices(`orphan-choices-${strategy}`)()).toHaveLength(0);
      expect(riddleStatuses(`orphan-choices-${strategy}`)).toEqual([]);
    });

    it('extracts a missing answer once before the commit', async () => {
      await plainSession(`narrated-repair-${strategy}`);
      const create = vi.fn().mockResolvedValue({ choices: [{ message: { content: '{"canonicalAnswer":"an echo","aliases":["echo"]}' } }] });
      vi.mocked(createChatClientForTier).mockReturnValue({ client: { chat: { completions: { create } } }, model: 'mock' } as unknown as ReturnType<typeof createChatClientForTier>);
      scriptTurnOutput({ ...FIXED_NARRATION_OUTPUT, narration: ECHO_NARRATION, narratedRiddle: { aliases: [] } });

      await act(`narrated-repair-${strategy}`, 'Pip calls out into the cave');

      expect(create).toHaveBeenCalledTimes(1);
      expect(riddleRepository.getActive(`narrated-repair-${strategy}`)).toMatchObject({ canonicalAnswer: 'an echo', answerKnown: true });
      vi.mocked(createChatClientForTier).mockReset();
    });

    it('records the riddle as answer unknown when the extraction fails', async () => {
      await plainSession(`narrated-unknown-${strategy}`);
      scriptTurnOutput({ ...FIXED_NARRATION_OUTPUT, narration: ECHO_NARRATION, narratedRiddle: { aliases: [] } });

      await act(`narrated-unknown-${strategy}`, 'Pip calls out into the cave');

      expect(riddleRepository.getActive(`narrated-unknown-${strategy}`)).toMatchObject({ source: 'narration', answerKnown: false });
      scriptTurnOutput();
      const attempt = await act(`narrated-unknown-${strategy}`, 'The answer is an echo');
      expect(attempt).toMatchObject({ ok: false, status: 409, body: { error: 'riddle_answer_unknown' } });
      await vi.waitFor(() => expect(riddleStatuses(`narrated-unknown-${strategy}`)).toEqual(['abandoned']));
    });

    it('never exposes a narrated answer in the turn result sent to clients', async () => {
      await plainSession(`narrated-private-${strategy}`);
      scriptTurnOutput({ ...FIXED_NARRATION_OUTPUT, narration: ECHO_NARRATION, narratedRiddle: { canonicalAnswer: 'an echo', aliases: [] } });
      const { toPublicTurn } = await import('../../services/sessionProjection.js');

      const result = await act(`narrated-private-${strategy}`, 'Pip calls out into the cave');

      expect(result.ok).toBe(true);
      const publicTurn = result.ok ? toPublicTurn(result.body.turnResult) : null;
      // Answer labels are public (players choose between them); what is right is not.
      expect(JSON.stringify(publicTurn)).not.toMatch(/narratedRiddle|canonicalAnswer|riddleCorrect|riddleAnswer/);
    });
  });
});
