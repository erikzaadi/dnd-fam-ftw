import { createChatClientForTier } from '../providers/ai/AiProviderFactory.js';

export const generateSessionDisplayName = async (worldDescription: string | undefined): Promise<string> => {
  const { client, model } = createChatClientForTier('preview');
  console.log(`[Session] Generating display name via OpenAI-compatible model=${model}`);
  const nameStart = Date.now();

  try {
    const nameResponse = await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: `Give me a short, evocative name (max 3 words) for a story setting based on: ${worldDescription || 'a random realm'}. Reply with the name only - no explanation, no punctuation, no markdown, no quotes.` }],
      max_tokens: 20,
    }, { signal: AbortSignal.timeout(20_000) });
    const msg = nameResponse.choices[0].message;
    console.log(`[Session] Display name received in ${Date.now() - nameStart}ms`);
    const rawName = msg.content || (msg as unknown as Record<string, string>)['reasoning_content'] || '';
    return rawName
      .replace(/<think>[\s\S]*?<\/think>/g, '')
      .split('\n')
      .map((l: string) => l.trim())
      .find((l: string) => l.length > 0) ?? 'A New Realm';
  } catch (err) {
    console.warn(`[Session] Display name generation failed or timed out (${Date.now() - nameStart}ms), using fallback:`, err);
    return 'A New Realm';
  }
};
