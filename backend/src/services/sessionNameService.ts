import { createChatClient } from '../providers/ai/AiProviderFactory.js';

export const generateSessionDisplayName = async (worldDescription: string | undefined, useLocalAI: boolean): Promise<string> => {
  const { client, model } = createChatClient(useLocalAI);
  const isLocal = process.env.AI_NARRATION_PROVIDER === 'localai';
  console.log(`[Session] Generating display name via ${isLocal ? 'LocalAI' : 'OpenAI'} model=${model}`);
  const nameStart = Date.now();

  try {
    const nameResponse = await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: `/no_think Give me a short, evocative name (max 3 words) for a story setting based on: ${worldDescription || 'a random realm'}. Reply with the name only, no explanation.` }],
      max_tokens: 100,
    }, { signal: AbortSignal.timeout(20_000) });
    console.log(`[Session] Display name received in ${Date.now() - nameStart}ms`);
    const msg = nameResponse.choices[0].message;
    const rawName = msg.content || (msg as unknown as Record<string, string>)['reasoning_content'] || '';
    console.log(`[Session] Raw display name response: ${JSON.stringify(rawName)}`);
    return rawName
      .replace(/<think>[\s\S]*?<\/think>/g, '')
      .replace(/\*\*/g, '')
      .replace(/\*/g, '')
      .replace(/\(.*?\)/g, '')
      .replace(/"/g, '')
      .replace(/\s*[-–—].*/g, '')
      .split('\n')
      .map((l: string) => l.trim())
      .find((l: string) => l.length > 0) ?? 'A New Realm';
  } catch (err) {
    console.warn(`[Session] Display name generation failed or timed out (${Date.now() - nameStart}ms), using fallback:`, err);
    return 'A New Realm';
  }
};
