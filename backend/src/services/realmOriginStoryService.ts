import { createChatClientForTier } from '../providers/ai/AiProviderFactory.js';
import { StateService } from './stateService.js';
import type { SessionState } from '../types.js';

function buildFallback(session: SessionState): string {
  const names = session.party.map(c => `${c.name} the ${c.class}`).join(', ');
  const realm = session.worldDescription?.trim() || session.displayName;
  return `${names} came together in ${realm}. Their story is about to begin.`;
}

// Scale length with party size: one setup paragraph plus roughly one per two heroes
function paragraphCount(session: SessionState): number {
  return 1 + Math.ceil(session.party.length / 2);
}

function buildPrompt(session: SessionState): string {
  const charLines = session.party.map(c => {
    const parts = [`${c.name}, a ${c.gender ? c.gender + ' ' : ''}${c.species} ${c.class}`];
    if (c.quirk) {
      parts.push(`quirk: ${c.quirk}`);
    }
    if (c.history) {
      parts.push(`history: ${c.history}`);
    }
    return parts.join(' - ');
  }).join('\n');

  const realmLine = session.worldDescription?.trim()
    ? `Realm: ${session.displayName}\nDescription: ${session.worldDescription}`
    : `Realm: ${session.displayName}`;

  const toneMap: Record<string, string> = {
    easy: 'low stakes, warm, forgiving',
    normal: 'balanced - real danger but fair odds',
    hard: 'high stakes, unforgiving',
  };
  const modeMap: Record<string, string> = {
    cinematic: 'drama and character moments over combat',
    balanced: 'mix of combat and story',
    fast: 'punchy and quick',
    'zug-ma-geddon': 'pure combat chaos',
  };
  const toneNote = toneMap[session.difficulty as string] ?? '';
  const modeNote = modeMap[session.gameMode as string] ?? '';

  let dmContext = '';
  if (session.dmPrep) {
    const premiseLine = session.dmPrep.split('\n').find(l => l.startsWith('PREMISE:'));
    if (premiseLine) {
      dmContext = `\nSetting premise: ${premiseLine.replace('PREMISE:', '').trim()}`;
    }
  }

  const paragraphs = paragraphCount(session);

  return `Write the opening origin story for a family-friendly D&D realm. Exactly ${paragraphs} short paragraphs: the first sets the realm and the stakes, the rest weave in the heroes. Plain prose, no headers.

${realmLine}${dmContext}
Tone: ${toneNote}
Style: ${modeNote}

Party:
${charLines}

Rules:
- Include every character at least once, using their name, class, species, and quirk naturally.
- Explain how they came together or why they share this mission.
- End at the moment just before the first action - do not resolve anything.
- Do not mention dice, stats, turns, UI, players, or sessions.
- Do not reveal hidden DM secrets as facts.
- Keep it family-friendly and adventurous.`;
}

// One generation per session at a time. Two viewers (or React StrictMode running the
// fetch effect twice in dev) used to start two model calls, get two different stories,
// and show one, then the other.
const inFlight = new Map<string, Promise<string>>();

async function generateOnce(sessionId: string): Promise<string> {
  const session = await StateService.getSession(sessionId);
  if (!session) {
    throw new Error(`Session ${sessionId} not found`);
  }
  if (session.originStory) {
    return session.originStory;
  }

  if (!session.party.length) {
    throw new Error('Cannot generate origin story for empty party');
  }

  const prompt = buildPrompt(session);
  const { client, model } = createChatClientForTier('async');
  console.log(`[OriginStory] Generating for session=${sessionId} model=${model}`);

  // Token budget tracks the party-scaled paragraph count used in the prompt
  const maxTokens = Math.min(600, 140 * paragraphCount(session) + 60);

  let text: string;
  try {
    const response = await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: maxTokens,
    }, { signal: AbortSignal.timeout(30_000) });
    const msg = response.choices[0].message;
    const raw = msg.content || (msg as unknown as Record<string, string>)['reasoning_content'] || '';
    text = raw.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/[—]/g, '-').trim();
    if (!text) {
      text = buildFallback(session);
    }
  } catch (err) {
    console.warn(`[OriginStory] Generation failed for session=${sessionId}:`, err);
    text = buildFallback(session);
  }

  if (!StateService.setOriginStoryIfMissing(sessionId, text, new Date().toISOString())) {
    // Another process stored one first: everyone gets that one.
    const stored = (await StateService.getSession(sessionId))?.originStory;
    console.log(`[OriginStory] Kept existing for session=${sessionId}`);
    return stored || text;
  }
  console.log(`[OriginStory] Persisted for session=${sessionId}`);
  return text;
}

export const RealmOriginStoryService = {
  generate(sessionId: string): Promise<string> {
    const pending = inFlight.get(sessionId);
    if (pending) {
      return pending;
    }
    const work = generateOnce(sessionId).finally(() => {
      inFlight.delete(sessionId);
    });
    inFlight.set(sessionId, work);
    return work;
  },
};
