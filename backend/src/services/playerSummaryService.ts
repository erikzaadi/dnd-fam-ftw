import { createChatClientForTier } from '../providers/ai/AiProviderFactory.js';
import type { SessionState, TurnResult } from '../types.js';

// Short summaries shown to players on request: the adventure so far (session page) and
// how a hero did in a past adventure (hero import). Not the rolling story summary the
// DM reads (storySummaryService.ts).

type ChatClient = ReturnType<typeof createChatClientForTier>;

export const ADVENTURE_SUMMARY_FALLBACK = 'The adventure was too legendary to put into words.';

export const buildAdventureSummaryPrompt = (session: SessionState | undefined, history: TurnResult[]): string => {
  const battlesLine = session?.pastEncounters?.length
    ? `\n\nBattles fought: ${session.pastEncounters.map(e => `${e.name} (${e.status})`).join(', ')}.`
    : '';

  const realmContext = [
    session?.displayName ? `Realm: ${session.displayName}` : '',
    session?.worldDescription ? `Description: ${session.worldDescription}` : '',
    session?.difficulty ? `Difficulty: ${session.difficulty}` : '',
    session?.gameMode ? `Mode: ${session.gameMode}` : '',
  ].filter(Boolean).join('. ');

  const formatChar = (c: { name: string; class: string; species: string; hp: number; status?: string }) => {
    const status = c.hp === 0 || c.status === 'downed' ? ' - downed' : '';
    return `${c.name} the ${c.class} (${c.species}${status})`;
  };
  const partyContext = session?.party.length
    ? `\n\nParty: ${session.party.map(formatChar).join('; ')}.`
    : '';

  const originContext = session?.originStory
    ? `\n\nOrigin: ${session.originStory}`
    : '';

  const narrationContext = history.length
    ? `\n\nAdventure so far:\n${history.map(h => h.narration).join(' ')}${battlesLine}`
    : '';

  const instruction = history.length
    ? '\n\nSummarize this adventure in 3 sentences for the players. Focus on main plot points, character moments, and current situation.'
    : '\n\nSummarize the realm and party premise in 2-3 sentences for the players. The adventure has not yet begun.';

  return `${realmContext}${partyContext}${originContext}${narrationContext}${instruction}`;
};

// The adventure so far, in a few sentences. Any failure gives the fallback line, except a
// provider 429, which is rethrown for the caller's rate-limit response.
export const summarizeAdventure = async (
  session: SessionState | undefined,
  history: TurnResult[],
  chat: ChatClient = createChatClientForTier('narration'),
): Promise<string> => {
  const { client, model } = chat;
  try {
    const response = await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: buildAdventureSummaryPrompt(session, history) }],
      max_tokens: 200,
    }, { signal: AbortSignal.timeout(20_000) });
    const msg = response.choices[0].message;
    return msg.content || (msg as unknown as Record<string, string>)['reasoning_content'] || '';
  } catch (err: unknown) {
    if ((err as { status?: number })?.status === 429) {
      throw err;
    }
    console.error('[Summary] Failed:', err);
    return ADVENTURE_SUMMARY_FALLBACK;
  }
};

export const buildHeroHistoryPrompt = (narrations: string[], adventureName?: string): string =>
  `Summarize in one sentence how this adventurer performed in their past adventure${adventureName ? ` in "${adventureName}"` : ''}: ${narrations.join(' ')}. Focus on their notable actions. Reply with just the sentence, no preamble.`;

// One sentence on a hero's last ten turns, or null when it cannot be written. Callers
// with no turns return null without asking.
export const summarizeHeroHistory = async (
  turns: { narration: string }[],
  adventureName: string | undefined,
  chat: ChatClient = createChatClientForTier('narration'),
): Promise<string | null> => {
  const { client, model } = chat;
  try {
    const response = await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: buildHeroHistoryPrompt(turns.slice(-10).map(t => t.narration), adventureName) }],
      max_tokens: 80,
    }, { signal: AbortSignal.timeout(15_000) });
    return (response.choices[0].message.content ?? '').trim();
  } catch {
    return null;
  }
};
