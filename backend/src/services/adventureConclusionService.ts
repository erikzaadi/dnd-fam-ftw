import { createChatClientForTier } from '../providers/ai/AiProviderFactory.js';
import { broadcastSessionChanged, broadcastUpdate } from '../realtime/sessionEvents.js';
import { sessionRepository } from '../repositories/sessionRepository.js';
import { commitTurn } from '../repositories/turnCommitRepository.js';
import type { AdventureResolution, SessionState, TurnResult } from '../types.js';
import { StateService } from './stateService.js';
import { devLog } from '../lib/devLog.js';

const CONCLUSION_TIMEOUT_MS = 25_000;

type HeroContribution = {
  name: string;
  actions: string[];
};

// Facts only from committed state and history. Private DM Prep and the chapter payoff
// are deliberately excluded so an ending cannot expose hidden material.
const collectContributions = (session: SessionState, history: TurnResult[]): HeroContribution[] => {
  const participating = new Set(session.adventure?.participatingHeroIds ?? []);
  return session.party
    .filter(hero => participating.has(hero.id) || history.some(turn => turn.characterId === hero.id))
    .map(hero => ({
      name: hero.name,
      actions: history
        .filter(turn => turn.characterId === hero.id && turn.lastAction?.actionAttempt)
        .slice(-3)
        .map(turn => `${turn.lastAction!.actionAttempt}${turn.lastAction!.actionResult.statUsed === 'none' ? '' : turn.lastAction!.actionResult.success ? ' (succeeded)' : ' (failed)'}`),
    }));
};

const RESOLUTION_GUIDANCE: Record<AdventureResolution, string> = {
  success: 'The party achieved the chapter objective. Celebrate what they actually did.',
  setback: 'The finale ended in a setback. The world changes because of it; it is meaningful, not hopeless. Do not turn it into a victory.',
  ended_early: 'The players chose to end the evening here. Summarize the actual stopping point honestly, including any unresolved danger or retreat. Grant no loot, healing, or victory that was not already earned.',
};

export const buildDeterministicEpilogue = (session: SessionState, history: TurnResult[], resolution: AdventureResolution): string => {
  const contributions = collectContributions(session, history);
  const objective = session.adventure?.objective;
  const opening = resolution === 'success'
    ? `And so the tale of ${session.displayName} reaches its end${objective ? `: ${objective.replace(/[.?!]+$/, '').toLowerCase()} - done` : ''}.`
    : resolution === 'setback'
      ? `The tale of ${session.displayName} ends with a hard lesson${objective ? `: ${objective.replace(/[.?!]+$/, '').toLowerCase()} slipped away this time` : ''}.`
      : `The party of ${session.displayName} makes camp for the night, the story paused mid-stride.`;
  const heroes = contributions.map(hero => {
    const last = hero.actions[hero.actions.length - 1];
    return last ? `${hero.name} will be remembered for this: ${last.replace(/ \((succeeded|failed)\)$/, '').toLowerCase()}.` : `${hero.name} stood with the party to the end.`;
  });
  const close = resolution === 'ended_early'
    ? 'Whatever waits in the dark will still be there next time.'
    : 'Somewhere, a bard is already getting the details wrong.';
  return [opening, ...heroes, close].join(' ');
};

export const generateEpilogueText = async (session: SessionState, history: TurnResult[], resolution: AdventureResolution): Promise<{ text: string; failed: boolean }> => {
  const contributions = collectContributions(session, history);
  const facts = {
    realm: session.displayName,
    objective: session.adventure?.objective ?? null,
    resolution,
    currentScene: session.scene,
    heroes: contributions,
    battles: (session.pastEncounters ?? []).map(enc => `${enc.name} (${enc.status})`),
    finalMoments: history.filter(turn => turn.turnType !== 'conclusion').slice(-4).map(turn => turn.narration),
  };
  const prompt = `Write the ending of a family fantasy game-night adventure from these committed facts:
${JSON.stringify(facts)}

${RESOLUTION_GUIDANCE[resolution]}
Rules:
- 4-7 sentences of prose, warm and funny, keeping the party's playful bickering but not burying the payoff.
- Say what changed in the world, and give EVERY hero listed a sentence about something they actually did (use their listed actions; invent no new deeds).
- End on a warm final beat.
- Use only the facts above: no new villains, twists, secrets, loot, or victories.
- No em dashes. No choices, no questions to the players.`;
  try {
    const { client, model } = createChatClientForTier('narration');
    const response = await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: prompt }],
      max_completion_tokens: 500,
    }, { signal: AbortSignal.timeout(CONCLUSION_TIMEOUT_MS) });
    const text = (response.choices[0]?.message?.content ?? '').replace(/—/g, '-').trim();
    if (text) {
      return { text, failed: false };
    }
  } catch (err) {
    console.warn(`[Adventure] Epilogue generation failed for session ${session.id}, using deterministic ending:`, err);
  }
  return { text: buildDeterministicEpilogue(session, history, resolution), failed: true };
};

// Generates and atomically commits the ending turn plus the completed lifecycle state.
// Idempotent across retries: it only acts while the chapter is still unfinished, and
// the revision check rejects a duplicate commit.
export const concludeAdventure = async (params: {
  sessionId: string;
  namespaceId: string | undefined;
  operationId?: string;
  resolution: AdventureResolution;
}): Promise<TurnResult | null> => {
  const { sessionId, namespaceId, operationId } = params;
  const session = await StateService.getSession(sessionId);
  if (!session?.adventure || session.adventure.status === 'completed') {
    return null;
  }
  // A chapter already concluding keeps the resolution its finale earned.
  const resolution = session.adventure.resolution ?? params.resolution;
  const history = await StateService.getTurnHistory(sessionId);
  const { text, failed } = await generateEpilogueText(session, history, resolution);
  devLog.log(`[Adventure] epilogue session=${sessionId} resolution=${resolution} fallback=${failed}`);

  const conclusionTurn: TurnResult = {
    narration: text,
    choices: [],
    imagePrompt: null,
    imageSuggested: false,
    imageUrl: null,
    turnType: 'conclusion',
    currentTensionLevel: 'low',
    narrationFailed: failed,
  };
  // The ending neither rolls nor rotates the actor.
  const completed: SessionState = {
    ...session,
    lastChoices: [],
    adventure: { ...session.adventure, status: 'completed', phase: 'epilogue', resolution, continueOffered: false },
  };
  const { turnId, revision } = commitTurn({
    sessionId,
    expectedRevision: session.revision ?? 0,
    state: completed,
    turn: conclusionTurn,
    characterId: null,
    operationId,
    completeOperation: true,
    additionalWrites: (_revision, committedTurnId) => {
      completed.adventure = { ...completed.adventure!, conclusionTurnId: committedTurnId };
      sessionRepository.writeAdventureSync(sessionId, completed.adventure);
    },
  });
  conclusionTurn.id = turnId;
  completed.revision = revision;
  broadcastUpdate(sessionId, 'adventure_concluded', { session: completed, turnResult: conclusionTurn, operationId, revision });
  broadcastSessionChanged(namespaceId, sessionId, 'updated');
  console.log(`[Adventure] Chapter ${completed.adventure!.chapter} concluded for session ${sessionId} (${resolution})`);
  return conclusionTurn;
};
