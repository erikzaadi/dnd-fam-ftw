import { createOpenAIClient, getModelForTier, getTierRequestSettings, warnIfEmptyTruncation } from '../providers/ai/openAiClient.js';
import { broadcastSessionUpdated } from '../realtime/sessionEvents.js';
import { sessionRepository } from '../repositories/sessionRepository.js';
import { devLog } from '../lib/devLog.js';

const MAX_OBJECTIVE_CHARS = 200;
const MAX_PAYOFF_CHARS = 500;
const COMPILE_TIMEOUT_MS = 10_000;

export type EveningObjective = {
  // Public: shown to players and used in prompts.
  objective: string;
  // Private: the chapter payoff the DM steers toward. Never shown to players.
  payoff: string | null;
};

// Campaign briefs for one-evening sessions include these two lines.
export const ONE_EVENING_BRIEF_INSTRUCTIONS = `TONIGHT'S OBJECTIVE: (one-evening format) one sentence, player-facing, naming a concrete problem this party can resolve in a single 30-60 minute session. It is one chapter of the wider world: wider hooks may stay open, but tonight must be satisfying on its own.
TONIGHT'S PAYOFF: (private DM note) 1-2 sentences on how tonight's finale can pay off an early clue or item, and what changes in the world whether the party succeeds or suffers a setback.`;

const clean = (text: string | undefined | null, max: number): string | null => {
  const trimmed = (text ?? '').replace(/\s+/g, ' ').replace(/—/g, '-').trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.length > max ? `${trimmed.slice(0, max - 3).trimEnd()}...` : trimmed;
};

export const parseEveningObjectiveFromBrief = (brief: string): EveningObjective | null => {
  const objective = clean(/TONIGHT'?S OBJECTIVE:\s*(?:\(one-evening format\)\s*)?([^\n]+)/i.exec(brief)?.[1], MAX_OBJECTIVE_CHARS);
  if (!objective) {
    return null;
  }
  const payoff = clean(/TONIGHT'?S PAYOFF:\s*(?:\(private DM note\)\s*)?([^\n]+)/i.exec(brief)?.[1], MAX_PAYOFF_CHARS);
  return { objective, payoff };
};

const OBJECTIVE_SYSTEM_PROMPT = `You turn tabletop RPG notes into ONE chapter for a single family game night (30-60 minutes).
Return JSON: {"objective": string, "payoff": string}.
- objective: one player-facing sentence naming a concrete problem the party can resolve tonight. Use names and places from the notes. Do not reveal secrets, twists, or hidden villains.
- payoff: 1-2 private DM sentences: how tonight's finale can pay off an early clue or item, and what changes whether the party succeeds or suffers a setback. Hidden truths may stay hidden.
If the notes describe a long campaign, pick a bounded first chapter within that world rather than the whole campaign.
Do not invent facts that contradict the notes. No em dashes. Family friendly.`;

export const compileEveningObjective = async (notes: string): Promise<EveningObjective | null> => {
  if (!notes.trim()) {
    return null;
  }
  const model = getModelForTier('preview');
  const start = Date.now();
  try {
    const response = await createOpenAIClient().chat.completions.create({
      model,
      messages: [
        { role: 'system', content: OBJECTIVE_SYSTEM_PROMPT },
        { role: 'user', content: notes.slice(0, 6000) },
      ],
      response_format: { type: 'json_object' },
      max_completion_tokens: 250,
      ...getTierRequestSettings('preview'),
    }, { signal: AbortSignal.timeout(COMPILE_TIMEOUT_MS) });
    warnIfEmptyTruncation('EveningObjective', model, response.choices[0]);
    const raw = response.choices[0]?.message?.content ?? '';
    const parsed = JSON.parse(raw) as { objective?: unknown; payoff?: unknown };
    const objective = clean(typeof parsed.objective === 'string' ? parsed.objective : null, MAX_OBJECTIVE_CHARS);
    devLog.log(`[EveningObjective] done model=${model} durationMs=${Date.now() - start} ok=${!!objective}`);
    if (!objective) {
      return null;
    }
    return { objective, payoff: clean(typeof parsed.payoff === 'string' ? parsed.payoff : null, MAX_PAYOFF_CHARS) };
  } catch (err) {
    // Never block play: the opening scene establishes a goal when compilation fails.
    console.warn(`[EveningObjective] compile failed after ${Date.now() - start}ms:`, err);
    return null;
  }
};

// Stores the objective once and tells viewers. Returns true when it was stored now.
export const storeEveningObjective = (sessionId: string, objective: EveningObjective): boolean => {
  const stored = sessionRepository.setAdventureObjectiveIfMissing(sessionId, objective.objective, objective.payoff);
  if (stored) {
    const revision = sessionRepository.getRevision(sessionId) ?? 0;
    void sessionRepository.getSession(sessionId).then(session => {
      if (session?.adventure) {
        broadcastSessionUpdated(sessionId, revision, { adventure: session.adventure });
      }
    });
    console.log(`[Adventure] Objective stored for session ${sessionId}`);
  }
  return stored;
};

// Compiles and stores an objective for an active one-evening chapter that has none.
// Explicit DM Prep is preferred; the realm description is the fallback premise.
export const ensureEveningObjective = async (sessionId: string, openingNarration?: string): Promise<void> => {
  const session = await sessionRepository.getSession(sessionId);
  const adventure = session?.adventure;
  if (!session || !adventure || adventure.format !== 'one_evening' || adventure.status !== 'active' || adventure.objective) {
    return;
  }
  const fromBrief = session.dmPrep ? parseEveningObjectiveFromBrief(session.dmPrep) : null;
  const notes = [
    session.displayName ? `Realm: ${session.displayName}` : '',
    session.worldDescription ? `Description: ${session.worldDescription}` : '',
    session.dmPrep ? `DM notes:\n${session.dmPrep}` : '',
    session.storySummary ? `Story so far: ${session.storySummary}` : '',
    // The chapter opening already happened: the objective must match what it set up.
    openingNarration ? `Tonight's opening scene: ${openingNarration}` : '',
  ].filter(Boolean).join('\n');
  const objective = fromBrief ?? await compileEveningObjective(notes);
  if (objective) {
    storeEveningObjective(sessionId, objective);
  }
};

// DM Prep changed mid-adventure: recompile only the private future intent. The public
// objective, counters and completed facts are preserved.
export const refreshChapterPayoff = async (sessionId: string): Promise<void> => {
  const session = await sessionRepository.getSession(sessionId);
  const adventure = session?.adventure;
  if (!session?.dmPrep || !adventure || adventure.status !== 'active') {
    return;
  }
  if (!adventure.objective) {
    await ensureEveningObjective(sessionId);
    return;
  }
  const compiled = await compileEveningObjective(`Current chapter objective (keep it): ${adventure.objective}\nDM notes:\n${session.dmPrep}`);
  if (compiled?.payoff) {
    sessionRepository.setAdventurePlan(sessionId, compiled.payoff);
  }
};
