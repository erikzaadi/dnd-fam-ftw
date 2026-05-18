import { createOpenAIClient, getModelForTier } from '../providers/ai/openAiClient.js';
import { devLog } from '../lib/devLog.js';

const SYSTEM_PROMPT = `You are a prep editor for a tabletop RPG DM. Given the DM's campaign notes, the current scene, and recent events, extract only what matters RIGHT NOW.

Output a single compact paragraph, max 400 chars. Always include: the main villain or final goal in one phrase. Then include any NPCs, locations, clues, or upcoming beats that directly connect to the current scene or the last 3 events. Omit everything else.`;

export async function extractRelevantDmPrep(
  rawDmPrep: string,
  context: { scene: string; storySummary?: string; recentHistory: string[]; encounterName?: string },
  timeBudgetMs = 3000,
): Promise<string> {
  if (rawDmPrep.length <= 3000) {
    return rawDmPrep;
  }

  const inputChars = rawDmPrep.length;
  devLog.log(`[DmPrepRelevance] start inputChars=${inputChars}`);
  const start = Date.now();

  try {
    const userPrompt = [
      `DM PREP:\n${rawDmPrep}`,
      `CURRENT SCENE: ${context.scene}`,
      `STORY SO FAR: ${context.storySummary ?? 'none'}`,
      `RECENT EVENTS: ${context.recentHistory.slice(-3).join(' | ') || 'none'}`,
      `ACTIVE ENCOUNTER: ${context.encounterName ?? 'none'}`,
    ].join('\n\n');

    const client = createOpenAIClient();
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), timeBudgetMs);

    let result: string;
    try {
      const response = await client.chat.completions.create(
        {
          model: getModelForTier('preview'),
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userPrompt },
          ],
          max_tokens: 200,
        },
        { signal: abortController.signal },
      );
      result = response.choices[0]?.message?.content?.trim() ?? '';
    } finally {
      clearTimeout(timeout);
    }

    if (!result) {
      devLog.log(`[DmPrepRelevance] done durationMs=${Date.now() - start} inputChars=${inputChars} outputChars=0 fallback=true`);
      return rawDmPrep.slice(0, 3000);
    }

    devLog.log(`[DmPrepRelevance] done durationMs=${Date.now() - start} inputChars=${inputChars} outputChars=${result.length} fallback=false`);
    return result;
  } catch {
    devLog.log(`[DmPrepRelevance] done durationMs=${Date.now() - start} inputChars=${inputChars} outputChars=0 fallback=true`);
    return rawDmPrep.slice(0, 3000);
  }
}
