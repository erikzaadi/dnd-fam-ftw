import { z } from 'zod';
import { createChatClientForTier } from '../providers/ai/AiProviderFactory.js';
import { getTierRequestSettings, warnIfEmptyTruncation } from '../providers/ai/openAiClient.js';
import { devLog } from '../lib/devLog.js';

const RIDDLE_REPAIR_TIMEOUT_MS = 8_000;

const extractedAnswerSchema = z.object({
  canonicalAnswer: z.string().trim().min(1).max(80).nullable(),
  aliases: z.array(z.string().trim().min(1).max(80)).max(6).optional().nullable(),
});

export type ExtractedRiddleAnswer = { canonicalAnswer: string; aliases: string[] };

// One bounded call that reads a riddle the narration already posed and names its answer.
// Returns null on any failure or when the riddle has no single clear answer; callers then
// record the riddle as "answer unknown" instead of guessing.
export const extractRiddleAnswer = async (narration: string, prompt?: string): Promise<ExtractedRiddleAnswer | null> => {
  const started = Date.now();
  try {
    const { client, model } = createChatClientForTier('preview');
    const response = await client.chat.completions.create({
      model,
      messages: [
        {
          role: 'system',
          content: [
            'A fantasy story just posed a riddle, password, or puzzle to the players.',
            'Name the one answer that solves it.',
            'Reply with JSON only: {"canonicalAnswer": "short answer" or null, "aliases": ["other short wordings of the same answer"]}.',
            'Use null when the riddle has no single clear answer. Never list wrong answers as aliases.',
          ].join(' '),
        },
        { role: 'user', content: prompt ? `Riddle: ${prompt}\n\nStory: ${narration}` : narration },
      ],
      response_format: { type: 'json_object' },
      max_completion_tokens: 80,
      ...getTierRequestSettings('preview'),
    }, { signal: AbortSignal.timeout(RIDDLE_REPAIR_TIMEOUT_MS) });
    warnIfEmptyTruncation('RiddleRepair', model, response.choices[0]);
    const raw = (response.choices[0]?.message?.content ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    const json = raw.match(/\{[\s\S]*\}/)?.[0];
    const parsed = json ? extractedAnswerSchema.safeParse(JSON.parse(json)) : null;
    devLog.log(`[RiddleRepair] done model=${model} durationMs=${Date.now() - started} ok=${parsed?.success ? 'true' : 'false'}`);
    if (!parsed?.success || !parsed.data.canonicalAnswer) {
      return null;
    }
    return { canonicalAnswer: parsed.data.canonicalAnswer, aliases: parsed.data.aliases ?? [] };
  } catch (err) {
    console.warn(`[RiddleRepair] failed durationMs=${Date.now() - started}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
};
