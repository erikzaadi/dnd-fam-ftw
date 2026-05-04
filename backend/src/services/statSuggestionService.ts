import { createChatClient } from '../providers/ai/AiProviderFactory.js';
import { StateService } from './stateService.js';

export const STAT_FALLBACK = { might: 2, magic: 2, mischief: 3 };
export type SuggestedStat = 'might' | 'magic' | 'mischief';

export async function suggestStatForSessionAction(
  sessionId: string,
  input: { action: string; characterClass?: string; characterQuirk?: string },
): Promise<SuggestedStat> {
  const { action, characterClass, characterQuirk } = input;
  const session = await StateService.getSession(sessionId);
  if (!session) {
    return 'mischief';
  }

  const { client, model } = createChatClient(session.useLocalAI);
  try {
    const response = await client.chat.completions.create({
      model,
      messages: [{
        role: 'user',
        content: `/no_think A fantasy RPG character${characterClass ? ` (${characterClass})` : ''}${characterQuirk ? `, quirk: ${characterQuirk}` : ''} wants to: "${action}". Which single stat fits best: might (physical strength, combat, force), magic (spells, arcane, healing, divine), or mischief (stealth, trickery, charm, persuasion, deception)? Reply with ONLY one word: might, magic, or mischief.`
      }],
      max_tokens: 10,
    }, { signal: AbortSignal.timeout(8_000) });
    const raw = (response.choices[0].message.content ?? '').toLowerCase().trim().replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    return (['might', 'magic', 'mischief'] as const).find(s => raw.includes(s)) ?? 'mischief';
  } catch {
    return 'mischief';
  }
}

export function parseSuggestedStats(raw: string): { might: number; magic: number; mischief: number } {
  const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  const match = cleaned.match(/\{[^}]+\}/);
  if (!match) {
    return { ...STAT_FALLBACK };
  }
  try {
    const parsed = JSON.parse(match[0]);
    return {
      might:    clamp(Math.round(parseStat(parsed.might,    STAT_FALLBACK.might))),
      magic:    clamp(Math.round(parseStat(parsed.magic,    STAT_FALLBACK.magic))),
      mischief: clamp(Math.round(parseStat(parsed.mischief, STAT_FALLBACK.mischief))),
    };
  } catch {
    return { ...STAT_FALLBACK };
  }
}

function parseStat(value: unknown, fallback: number): number {
  if (value == null) {
    return fallback;
  }
  const n = Number(value);
  return isNaN(n) ? fallback : n;
}

function clamp(n: number): number {
  return Math.min(5, Math.max(1, n));
}
