import { createOpenAIClient, getModelForTier } from '../providers/ai/openAiClient.js';
import { devLog } from '../lib/devLog.js';

const MAX_PREMISE_CHARS = 600;
const COMPILE_TIMEOUT_MS = 8000;

export async function compileDmPrepPremise(dmPrep: string): Promise<string | null> {
  if (!dmPrep || dmPrep.trim().length < 50) {
    return null;
  }
  const model = getModelForTier('preview');
  const start = Date.now();
  try {
    const response = await createOpenAIClient().chat.completions.create({
      model,
      messages: [
        {
          role: 'system',
          content: `You summarize a tabletop RPG campaign brief into a compact premise for use as in-game DM context.
Write exactly 3-5 sentences covering: the main villain or final goal, the realm or setting flavor, the active campaign direction or current stakes, and any named NPCs or factions still in play.
Do not describe encounter mechanics, stat blocks, enemy weaknesses, area images, or encounter seeds - those are handled separately.
Be specific: use names, places, and hooks from the source text. Do not invent details not present in the source.
Output only the premise sentences with no preamble, headers, or commentary. No em dashes.`,
        },
        {
          role: 'user',
          content: `Summarize this campaign brief into 3-5 sentences:\n\n${dmPrep}`,
        },
      ],
      max_completion_tokens: 200,
      temperature: 0.3,
    }, { signal: AbortSignal.timeout(COMPILE_TIMEOUT_MS) });

    const durationMs = Date.now() - start;
    const text = response.choices[0]?.message?.content?.trim() ?? '';
    devLog.log(`[DmPrepCompile] done model=${model} durationMs=${durationMs} chars=${text.length}`);

    if (!text) {
      return null;
    }
    return text.length > MAX_PREMISE_CHARS ? text.slice(0, MAX_PREMISE_CHARS) : text;
  } catch (err) {
    const durationMs = Date.now() - start;
    devLog.warn(`[DmPrepCompile] failed model=${model} durationMs=${durationMs}`, err);
    return null;
  }
}
