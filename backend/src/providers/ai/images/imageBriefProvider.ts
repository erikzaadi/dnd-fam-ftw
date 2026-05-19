import type { TensionLevel } from '../../../types.js';
import { createOpenAIClient, getModelForTier } from '../openAiClient.js';
import { devLog } from '../../../lib/devLog.js';

const SAFE_WORD_GUIDANCE = `Safe word substitutions (the image API is sensitive to these):
- Never use: undead, corpse, dead, zombie, skeleton, gore, blood, kill, death, decapitate, mutilate
- Instead use: spectral, ethereal, skeletal warrior, cursed, shadowy, necrotic, withered
- Describe actions as: clashes with, faces, confronts, battles, defends against`;

const SYSTEM_PROMPT = `You write short visual image briefs for a fantasy scene.
Output a single sentence of 15-25 words describing: who is in the scene, what action is happening, the environment, and the mood.
Do NOT include art style phrases, rendering guidance, or technical instructions.
Do NOT include text, writing, letters, numbers, runes, glyphs, symbols, inscriptions, book pages, title cards, posters, maps with markings, signs, banners with markings, labels, captions, UI, cards, or panels.
If the scene needs magic, show it as glow, light, mist, particles, color, or motion. Never describe floating words, arcane letters, readable markings, or pseudo-writing.
${SAFE_WORD_GUIDANCE}
Output only the brief sentence. No preamble, no explanation.`;

export async function generateImageBrief(
  narration: string,
  scene: string,
  actingCharacterName: string | undefined,
  tensionLevel: TensionLevel | undefined,
): Promise<string | null> {
  const model = getModelForTier('preview');
  const start = Date.now();
  const userContent = [
    `Scene: ${scene}`,
    actingCharacterName ? `Acting character: ${actingCharacterName}` : null,
    tensionLevel ? `Tension: ${tensionLevel}` : null,
    `\nNarration:\n${narration}`,
  ].filter(Boolean).join('\n');

  try {
    const response = await createOpenAIClient().chat.completions.create({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
      max_completion_tokens: 60,
      temperature: 0.5,
    }, { signal: AbortSignal.timeout(8000) });

    const durationMs = Date.now() - start;
    const text = response.choices[0]?.message?.content?.trim() ?? null;
    devLog.log(`[ImageBrief] done model=${model} durationMs=${durationMs} chars=${text?.length ?? 0}`);
    return text;
  } catch (err) {
    const durationMs = Date.now() - start;
    devLog.warn(`[ImageBrief] failed model=${model} durationMs=${durationMs}`, err);
    return null;
  }
}
