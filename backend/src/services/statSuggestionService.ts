import { createChatClient } from '../providers/ai/AiProviderFactory.js';
import type { FreeActionBonusPreview } from './freeActionInferenceService.js';
import { inferFreeActionBonuses, toFreeActionBonusPreview } from './freeActionInferenceService.js';
import { StateService } from './stateService.js';
import type { Character } from '../types.js';

export const STAT_FALLBACK = { might: 2, magic: 2, mischief: 3 };
export type SuggestedStat = 'might' | 'magic' | 'mischief';
export type SessionActionStatSuggestion = FreeActionBonusPreview & { stat: SuggestedStat };
export type PreviewActionIntent =
  | 'use_item_scene'
  | 'improve_item'
  | 'bless_character'
  | 'aid_character'
  | 'party_boost';

export type PreviewActionContext = {
  intent?: PreviewActionIntent;
  targetCharacterId?: string;
  itemOwnerCharacterId?: string;
  itemId?: string;
  method?: 'enchant' | 'craft' | 'tinker';
};

async function buildFreeActionStoryContext(sessionId: string): Promise<string> {
  const [session, history] = await Promise.all([
    StateService.getSession(sessionId),
    StateService.getTurnHistory(sessionId),
  ]);
  if (!session) {
    return '';
  }

  const currentNarration = history[history.length - 1]?.narration ?? session.recentHistory.at(-1);
  const previousNarrations = history
    .slice(-5, -1)
    .map((turn, index) => `${index + 1}. ${turn.narration}`)
    .join('\n');
  const storySummary = session.storySummary?.trim();

  return [
    storySummary ? `Story summary:\n${storySummary}` : '',
    previousNarrations ? `Previous turn narrations:\n${previousNarrations}` : '',
    currentNarration ? `Current turn narration:\n${currentNarration}` : '',
  ].filter(Boolean).join('\n\n');
}

export async function previewFreeAction(
  sessionId: string,
  input: { action: string },
): Promise<SessionActionStatSuggestion & { narration?: string; interpretedAction?: string }> {
  const { action } = input;
  const session = await StateService.getSession(sessionId);
  if (!session) {
    return { stat: 'mischief' };
  }
  const character = session.party.find(c => c.id === session.activeCharacterId) ?? session.party[0] ?? null;
  const bonusPreview = character
    ? toFreeActionBonusPreview(inferFreeActionBonuses(action, character, session))
    : {};
  const storyContext = await buildFreeActionStoryContext(sessionId);

  const { client, model } = createChatClient();
  try {
    const response = await client.chat.completions.create({
      model,
      messages: [{
        role: 'user',
        content: `${describeActiveCharacter(character)} wants to: "${action}".
${storyContext ? `\nUse this story context so the preview fits the current scene without spoiling the result:\n${storyContext}\n` : ''}

Reply with ONLY valid JSON (no markdown):
{
  "action": "<polished first-person or third-person action sentence, preserving the player's intent>",
  "stat": "might" | "magic" | "mischief",
  "narration": "<one short evocative sentence, 8-14 words, describing what the character does>"
}

Stat guide: might = physical/combat/force, magic = spells/arcane/healing/divine, mischief = stealth/trickery/charm/persuasion.`,
      }],
      max_tokens: 80,
    }, { signal: AbortSignal.timeout(8_000) });
    const raw = (response.choices[0].message.content ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as { stat?: string; narration?: string };
      const interpretedAction = typeof (parsed as { action?: unknown }).action === 'string'
        ? (parsed as { action: string }).action.trim()
        : undefined;
      const stat = (['might', 'magic', 'mischief'] as const).find(s => parsed.stat === s) ?? 'mischief';
      const narration = typeof parsed.narration === 'string' ? parsed.narration.trim() : undefined;
      return { stat, ...(interpretedAction && { interpretedAction }), narration, ...bonusPreview };
    }
    const stat = (['might', 'magic', 'mischief'] as const).find(s => raw.includes(s)) ?? 'mischief';
    return { stat, ...bonusPreview };
  } catch {
    return { stat: 'mischief', ...bonusPreview };
  }
}

function fallbackActionForIntent(character: Character | null, context: PreviewActionContext): string {
  const actorName = character?.name ?? 'The hero';
  if (context.intent === 'party_boost') {
    return `${actorName} rallies the whole party with a short-lived boost`;
  }
  if (context.intent === 'bless_character') {
    return `${actorName} blesses an ally with short-lived protective magic`;
  }
  if (context.intent === 'aid_character') {
    return `${actorName} aids an ally with a coordinated setup`;
  }
  if (context.intent === 'improve_item') {
    return `${actorName} improves a piece of gear for the current danger`;
  }
  return `${actorName} uses carried gear to help with the current situation`;
}

export async function suggestPreviewActionText(
  sessionId: string,
  context: PreviewActionContext,
): Promise<string> {
  const session = await StateService.getSession(sessionId);
  if (!session) {
    return fallbackActionForIntent(null, context);
  }
  const actor = session.party.find(c => c.id === session.activeCharacterId) ?? session.party[0] ?? null;
  const target = context.targetCharacterId
    ? session.party.find(c => c.id === context.targetCharacterId)
    : null;
  const itemOwner = context.itemOwnerCharacterId
    ? session.party.find(c => c.id === context.itemOwnerCharacterId)
    : actor;
  const item = context.itemId
    ? itemOwner?.inventory.find(i => i.id === context.itemId)
    : null;
  const storyContext = await buildFreeActionStoryContext(sessionId);

  const targetLine = target
    ? `Target ally: ${target.name}, ${target.species} ${target.class}, stats might ${target.stats.might}, magic ${target.stats.magic}, mischief ${target.stats.mischief}.`
    : '';
  const itemLine = item && itemOwner
    ? `Target gear: ${itemOwner.name}'s ${item.name}. Description: ${item.description}. Effect: ${item.effect ?? 'none'}. Tags: ${(item.tags ?? []).join(', ') || 'none'}.`
    : '';

  const { client, model } = createChatClient();
  try {
    const response = await client.chat.completions.create({
      model,
      messages: [{
        role: 'user',
        content: `${describeActiveCharacter(actor)}
Intent: ${context.intent ?? 'custom'}
Method: ${context.method ?? 'none'}
${targetLine}
${itemLine}
${storyContext ? `\nCurrent story context:\n${storyContext}\n` : ''}

Write the exact player action to preview for this intent. It must:
- fit the current scene and the acting character's class, stats, and quirk
- be one sentence, 8-18 words
- name the target ally or gear when provided
- avoid promising success or final results

Reply with ONLY valid JSON: {"action":"..."}`,
      }],
      max_tokens: 90,
    }, { signal: AbortSignal.timeout(8_000) });
    const raw = (response.choices[0].message.content ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as { action?: string };
      if (typeof parsed.action === 'string' && parsed.action.trim()) {
        return parsed.action.trim();
      }
    }
  } catch {
    // Fall through to deterministic fallback.
  }

  return fallbackActionForIntent(actor, context);
}

export async function suggestStatForSessionAction(
  sessionId: string,
  input: { action: string },
): Promise<SessionActionStatSuggestion> {
  const { action } = input;
  const session = await StateService.getSession(sessionId);
  if (!session) {
    return { stat: 'mischief' };
  }
  const character = session.party.find(c => c.id === session.activeCharacterId) ?? session.party[0] ?? null;
  const bonusPreview = character
    ? toFreeActionBonusPreview(inferFreeActionBonuses(action, character, session))
    : {};
  const storyContext = await buildFreeActionStoryContext(sessionId);

  const { client, model } = createChatClient();
  try {
    const response = await client.chat.completions.create({
      model,
      messages: [{
        role: 'user',
        content: `${describeActiveCharacter(character)} wants to: "${action}".${storyContext ? `\n\nCurrent story context:\n${storyContext}` : ''}\n\nWhich single stat fits best in this scene: might (physical strength, combat, force), magic (spells, arcane, healing, divine), or mischief (stealth, trickery, charm, persuasion, deception)? Reply with ONLY one word: might, magic, or mischief.`
      }],
      max_tokens: 10,
    }, { signal: AbortSignal.timeout(8_000) });
    const raw = (response.choices[0].message.content ?? '').toLowerCase().trim().replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    const stat = (['might', 'magic', 'mischief'] as const).find(s => raw.includes(s)) ?? 'mischief';
    return { stat, ...bonusPreview };
  } catch {
    return { stat: 'mischief', ...bonusPreview };
  }
}

function describeActiveCharacter(character: Character | null): string {
  if (!character) {
    return 'The current fantasy RPG character';
  }

  const stats = `might ${character.stats.might}, magic ${character.stats.magic}, mischief ${character.stats.mischief}`;
  const quirk = character.quirk ? `, quirk: ${character.quirk}` : '';
  return `The current fantasy RPG character is ${character.name}, a ${character.species} ${character.class} (${stats}${quirk})`;
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
