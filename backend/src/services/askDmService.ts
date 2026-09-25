import { z } from 'zod';
import { createChatClientForTier } from '../providers/ai/AiProviderFactory.js';
import { getTierRequestSettings, warnIfEmptyTruncation } from '../providers/ai/openAiClient.js';
import { operationRepository } from '../repositories/operationRepository.js';
import { riddleRepository } from '../repositories/riddleRepository.js';
import { turnHistoryRepository } from '../repositories/turnHistoryRepository.js';
import { devLog } from '../lib/devLog.js';
import type { AskDmPayload, SessionState } from '../types.js';
import { mentionsRiddleAnswer } from './riddleService.js';
import { StateService } from './stateService.js';

// "Ask the DM": a short, non-mutating answer to an out-of-character question about the
// scene ("can I climb the wall?", "what does my amulet do?"). Grounded only in what the
// players can already know. Never stored, never advances the story or the revision.

export type AskDmRequest = {
  question: string;
  turnId: number;
  revision: number;
};

export type AskDmResult =
  | { ok: true; payload: AskDmPayload }
  | { ok: false; status: number; body: { error: string; message: string } };

const ASK_TIMEOUT_MS = 8_000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_QUESTIONS = 6;
const questionTimes = new Map<string, number[]>();

// Replaces any reply that names the answer of the open riddle.
export const RIDDLE_SAFE_ANSWER = "That's a riddle for you to solve! Have a guess, the DM is listening.";

const reject = (status: number, error: string, message: string): AskDmResult => ({ ok: false, status, body: { error, message } });

const answerSchema = z.object({ answer: z.string().trim().min(1).max(600) });

export const resetAskDmStateForTests = (): void => {
  questionTimes.clear();
};

const takeRateLimitSlot = (sessionId: string): boolean => {
  const now = Date.now();
  const recent = (questionTimes.get(sessionId) ?? []).filter(time => now - time < RATE_LIMIT_WINDOW_MS);
  if (recent.length >= RATE_LIMIT_MAX_QUESTIONS) {
    questionTimes.set(sessionId, recent);
    return false;
  }
  questionTimes.set(sessionId, [...recent, now]);
  return true;
};

// Public facts only: no DM Prep, chapter plan, story summary, or riddle answers.
export const buildAskContext = (session: SessionState, latestNarration: string | null, riddlePrompt: string | null): string => {
  const hero = session.party.find(c => c.id === session.activeCharacterId) ?? session.party[0];
  const lines: string[] = [
    `Scene: ${session.scene}`,
    latestNarration ? `What just happened: ${latestNarration}` : '',
    'Party: ' + session.party.map(c => `${c.name} (${c.species} ${c.class}, ${c.hp}/${c.max_hp} HP${c.status === 'downed' ? ', downed' : ''})`).join('; '),
  ];
  if (hero) {
    lines.push(`Acting hero: ${hero.name}. Stats: might ${hero.stats.might}, magic ${hero.stats.magic}, mischief ${hero.stats.mischief}. Quirk: ${hero.quirk}.`);
    lines.push(hero.inventory.length > 0
      ? `${hero.name} carries: ${hero.inventory.map(item => `${item.name} (${item.description})`).join('; ')}`
      : `${hero.name} carries nothing.`);
    const others = session.party.filter(c => c.id !== hero.id && c.inventory.length > 0);
    if (others.length > 0) {
      lines.push('Other heroes carry: ' + others.map(c => `${c.name}: ${c.inventory.map(item => item.name).join(', ')}`).join('; '));
    }
  }
  const encounter = session.encounterState;
  if (encounter?.status === 'active') {
    lines.push(`Fight: ${encounter.name}. Foes: ` + encounter.enemies.map(enemy => {
      const weak = (enemy.weaknesses ?? []).map(w => w.label).filter(Boolean);
      return `${enemy.name} (${enemy.hp}/${enemy.maxHp} HP, ${enemy.status}${weak.length > 0 ? `, weak point: ${weak.join(', ')}` : ''})`;
    }).join('; '));
  }
  if (riddlePrompt) {
    lines.push(`An unsolved riddle is open: ${riddlePrompt}`);
  }
  return lines.filter(Boolean).join('\n');
};

const SYSTEM_PROMPT = [
  'You are the Dungeon Master of a family fantasy game. A player asks you a quick question outside the story.',
  'Answer in one to three short, friendly sentences a child can follow, using only the facts given.',
  'Suggest what they could try; never decide outcomes, roll dice, or move the story forward.',
  'Never invent items, spells, or abilities a hero does not have. If they ask about something they do not have, say so kindly and point to what they do have.',
  'Never reveal or hint at the answer to a riddle; encourage them to guess instead.',
  'Do not use em dashes.',
  'Reply with JSON only: {"answer": "..."}.',
].join(' ');

export const askDm = async (sessionId: string, request: AskDmRequest): Promise<AskDmResult> => {
  const session = await StateService.getSession(sessionId);
  if (!session) {
    return reject(404, 'not_found', 'Session not found');
  }
  if (session.gameOver) {
    return reject(409, 'game_over', 'This campaign has ended.');
  }
  if (operationRepository.getActive(sessionId)) {
    return reject(409, 'operation_in_progress', 'The DM is busy with the current action. Ask again in a moment.');
  }
  const latestTurnId = turnHistoryRepository.getLatestTurnId(sessionId);
  if (latestTurnId !== request.turnId || (session.revision ?? 0) !== request.revision) {
    return reject(409, 'stale_question', 'The story moved on. Ask again about the latest scene.');
  }
  if (!takeRateLimitSlot(sessionId)) {
    return reject(429, 'ask_rate_limited', 'Lots of questions already! Try again in a minute, or just say what you try.');
  }

  const riddle = riddleRepository.getActive(sessionId);
  const context = buildAskContext(session, turnHistoryRepository.getNarration(latestTurnId), riddle?.prompt ?? null);
  const started = Date.now();
  try {
    const { client, model } = createChatClientForTier('preview');
    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `${context}\n\nQuestion: ${request.question}` },
      ],
      response_format: { type: 'json_object' },
      max_completion_tokens: 200,
      ...getTierRequestSettings('preview'),
    }, { signal: AbortSignal.timeout(ASK_TIMEOUT_MS) });
    warnIfEmptyTruncation('AskDm', model, response.choices[0]);
    const raw = (response.choices[0]?.message?.content ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    const json = raw.match(/\{[\s\S]*\}/)?.[0];
    const parsed = json ? answerSchema.safeParse(JSON.parse(json)) : null;
    devLog.log(`[AskDm] done session=${sessionId} model=${model} durationMs=${Date.now() - started} ok=${parsed?.success ? 'true' : 'false'}`);
    if (!parsed?.success) {
      return reject(502, 'ask_failed', 'The DM did not catch that. Ask again, or just say what you try.');
    }
    const cleaned = parsed.data.answer.replace(/\s*[—–]\s*/g, ' - ');
    const answer = riddle && mentionsRiddleAnswer(cleaned, riddle) ? RIDDLE_SAFE_ANSWER : cleaned;
    return { ok: true, payload: { turnId: request.turnId, revision: request.revision, question: request.question, answer } };
  } catch (err) {
    console.warn(`[AskDm] failed session=${sessionId} durationMs=${Date.now() - started}: ${err instanceof Error ? err.message : String(err)}`);
    return reject(502, 'ask_failed', 'The DM did not catch that. Ask again, or just say what you try.');
  }
};
