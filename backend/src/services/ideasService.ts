import { getDb } from '../persistence/database.js';
import { withTransaction } from '../persistence/transaction.js';
import { broadcastUpdate } from '../realtime/sessionEvents.js';
import { operationRepository } from '../repositories/operationRepository.js';
import { areIdeasCurrent, turnHistoryRepository } from '../repositories/turnHistoryRepository.js';
import type { AIInput, Choice, IdeasPayload, SessionState, TurnResult } from '../types.js';
import { toNarrationInput } from './aiDmService.js';
import { runChoicesWithRetry, toPlayerChoices } from './dmTurnOrchestrator.js';
import { createNarrationProvider } from '../providers/ai/AiProviderFactory.js';
import { ensureActiveRiddle, syncRiddleChoices } from './riddleService.js';
import { toPublicChoice } from './sessionProjection.js';
import { StateService } from './stateService.js';

// Suggested actions on request ("Give me ideas"). Ideas are the latest turn's choices,
// generated lazily for the current turn, revision, and acting hero, and shared by every
// viewer. Requesting ideas never advances the story or bumps the revision.

export type IdeasRequest = {
  turnId: number;
  revision: number;
  // Onboarding sessions ask once by themselves after the opening scene.
  reason?: 'onboarding_auto';
  // Replace ideas that came from the deterministic fallback.
  retry?: boolean;
};

export type IdeasResult =
  | { ok: true; payload: IdeasPayload }
  | { ok: false; status: number; body: { error: string; message: string } };

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_GENERATIONS = 6;
const generationTimes = new Map<string, number[]>();
const inFlight = new Map<string, Promise<IdeasResult>>();

const reject = (status: number, error: string, message: string): IdeasResult => ({ ok: false, status, body: { error, message } });

const STALE = reject(409, 'stale_ideas', 'The story moved on. Ask again for ideas about the latest scene.');

const toPayload = (turnId: number, revision: number, characterId: string, choices: Choice[], degraded: boolean): IdeasPayload => ({
  turnId,
  revision,
  characterId,
  choices: choices.map(toPublicChoice),
  degraded,
});

// Rejections shared by the pre-check and the atomic write. Only the latest turn, at the
// current revision, with no action in progress and the adventure still running, can
// receive ideas.
const checkRequestable = (session: SessionState, request: IdeasRequest): IdeasResult | null => {
  if (session.gameOver) {
    return reject(409, 'game_over', 'This campaign has ended.');
  }
  if (session.adventure && session.adventure.status !== 'active') {
    return reject(409, 'adventure_completed', 'The story is reaching its ending.');
  }
  if (operationRepository.getActive(session.id)) {
    return reject(409, 'operation_in_progress', 'An action is still being resolved. Ask for ideas once it finishes.');
  }
  const meta = turnHistoryRepository.getLatestIdeasMeta(session.id);
  if (!meta || meta.turnId !== request.turnId || (session.revision ?? 0) !== request.revision) {
    return STALE;
  }
  return null;
};

const takeRateLimitSlot = (sessionId: string): boolean => {
  const now = Date.now();
  const recent = (generationTimes.get(sessionId) ?? []).filter(time => now - time < RATE_LIMIT_WINDOW_MS);
  if (recent.length >= RATE_LIMIT_MAX_GENERATIONS) {
    generationTimes.set(sessionId, recent);
    return false;
  }
  generationTimes.set(sessionId, [...recent, now]);
  return true;
};

// Runs the same choices path as a turn (prompt, retries, top-stat coverage, sanitizers,
// deterministic fallback) for the scene as it stands and the hero who acts next.
const generate = async (session: SessionState, history: TurnResult[]): Promise<{ choices: Choice[]; degraded: boolean }> => {
  const latest = history[history.length - 1];
  const aiInput: AIInput = {
    ...session,
    actionAttempt: latest?.lastAction?.actionAttempt ?? 'The scene continues.',
    actionResult: latest?.lastAction?.actionResult ?? { success: true, roll: 0, statUsed: 'none' },
    characterId: latest?.characterId ?? session.activeCharacterId,
  };
  const input = toNarrationInput(aiInput);
  // Through the provider, so the test mock (TEST_AI_MOCK) serves ideas without an API call.
  const provider = createNarrationProvider();
  const generated = provider.generateIdeas
    ? await provider.generateIdeas(input)
    : await runChoicesWithRetry(input).then(flow => ({ choices: toPlayerChoices(flow.choices, input), degraded: flow.usedFallback }));
  const choices = generated.choices;
  // Riddle answers follow the recorded riddle, never the agent's guess.
  const riddle = ensureActiveRiddle(session);
  const synced = syncRiddleChoices(choices, !riddle ? null : riddle.canonicalAnswer ? { canonicalAnswer: riddle.canonicalAnswer, aliases: riddle.aliases } : 'unknown');
  return { choices: synced, degraded: generated.degraded };
};

// Stores the ideas only if nothing changed while they were generated: same latest turn,
// same revision, same acting hero, no action accepted meanwhile. Turn acceptance writes
// under the same immediate transaction, so an accepted action always wins.
const storeIfStillCurrent = (sessionId: string, request: IdeasRequest, characterId: string, choices: Choice[], degraded: boolean): boolean => withTransaction(() => {
  const row = getDb().prepare('SELECT revision, activeCharacterId, game_over, adventure_status FROM sessions WHERE id = ?')
    .get(sessionId) as { revision: number | null; activeCharacterId: string | null; game_over: number; adventure_status: string | null } | undefined;
  const meta = turnHistoryRepository.getLatestIdeasMeta(sessionId);
  const current = !!row && !!meta
    && meta.turnId === request.turnId
    && (row.revision ?? 0) === request.revision
    && (row.activeCharacterId ?? '') === characterId
    && !row.game_over
    && (row.adventure_status ?? 'active') === 'active'
    && !operationRepository.getActive(sessionId);
  if (!current) {
    return false;
  }
  turnHistoryRepository.replaceIdeasSync(request.turnId, choices, request.revision, characterId, degraded);
  return true;
});

const claimOnboardingRequest = (sessionId: string): boolean =>
  getDb().prepare("UPDATE sessions SET onboarding_ideas = 'requested' WHERE id = ? AND onboarding_ideas = 'pending'").run(sessionId).changes > 0;

const produceIdeas = async (sessionId: string, request: IdeasRequest): Promise<IdeasResult> => {
  const session = await StateService.getSession(sessionId);
  if (!session) {
    return reject(404, 'not_found', 'Session not found');
  }
  const blocked = checkRequestable(session, request);
  if (blocked) {
    return blocked;
  }
  const characterId = session.activeCharacterId;
  const meta = turnHistoryRepository.getLatestIdeasMeta(sessionId);
  // session.lastChoices holds only current ideas, so existing ones are served as they are.
  if (meta && session.lastChoices.length > 0 && areIdeasCurrent(meta, session) && !(request.retry && meta.ideasDegraded)) {
    return { ok: true, payload: toPayload(request.turnId, request.revision, characterId, session.lastChoices, meta.ideasDegraded) };
  }
  if (!takeRateLimitSlot(sessionId)) {
    return reject(429, 'ideas_rate_limited', 'Lots of ideas already! Try one, or ask again in a minute.');
  }

  const history = await StateService.getTurnHistory(sessionId);
  let generated: { choices: Choice[]; degraded: boolean };
  try {
    generated = await generate(session, history);
  } catch (err) {
    console.warn(`[Ideas] generation failed session=${sessionId}: ${err instanceof Error ? err.message : String(err)}`);
    return reject(503, 'ideas_unavailable', 'The DM could not think of anything just now. Try again in a moment.');
  }
  if (generated.choices.length === 0) {
    return reject(503, 'ideas_unavailable', 'The DM could not think of anything just now. Try again in a moment.');
  }
  if (!storeIfStillCurrent(sessionId, request, characterId, generated.choices, generated.degraded)) {
    return STALE;
  }
  console.log(`[Ideas] stored session=${sessionId} turn=${request.turnId} revision=${request.revision} degraded=${generated.degraded}`);
  const payload = toPayload(request.turnId, request.revision, characterId, generated.choices, generated.degraded);
  // Not a turn: views swap in the ideas without narration, dice, or turn effects.
  broadcastUpdate(sessionId, 'ideas_updated', { ...payload });
  return { ok: true, payload };
};

// One generation per (session, turn, revision); concurrent callers share its result.
export const requestIdeas = async (sessionId: string, request: IdeasRequest): Promise<IdeasResult> => {
  if (request.reason === 'onboarding_auto' && !claimOnboardingRequest(sessionId)) {
    return reject(409, 'already_requested', 'Ideas were already requested for this adventure.');
  }
  const key = `${sessionId}:${request.turnId}:${request.revision}:${request.retry ? 'retry' : 'first'}`;
  const pending = inFlight.get(key);
  if (pending) {
    return pending;
  }
  const work = produceIdeas(sessionId, request).finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, work);
  return work;
};

export const resetIdeasStateForTests = (): void => {
  generationTimes.clear();
  inFlight.clear();
};
