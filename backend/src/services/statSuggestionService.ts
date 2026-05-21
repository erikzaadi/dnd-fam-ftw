import { createChatClientForTier } from '../providers/ai/AiProviderFactory.js';
import type { FreeActionBonusPreview } from './freeActionInferenceService.js';
import { inferFreeActionBonuses, toFreeActionBonusPreview } from './freeActionInferenceService.js';
import { StateService } from './stateService.js';
import type { Character, EncounterEnemy, EncounterWeakness, FreeActionPreview } from '../types.js';

import { devLog } from '../lib/devLog.js';

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
  const start = Date.now();
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

  const context = [
    storySummary ? `Story summary:\n${storySummary}` : '',
    previousNarrations ? `Previous turn narrations:\n${previousNarrations}` : '',
    currentNarration ? `Current turn narration:\n${currentNarration}` : '',
  ].filter(Boolean).join('\n\n');
  devLog.log(`[PreviewAction] story-context session=${sessionId} durationMs=${Date.now() - start} history=${history.length} chars=${context.length}`);
  return context;
}

type EncounterPreviewContext = {
  activeEnemies: Array<{
    id: string;
    name: string;
    weaknesses: Array<{ id: string; label: string; school?: EncounterWeakness['school']; revealed: boolean; broken?: boolean }>;
  }>;
};

type PreviewEncounterFields = Pick<FreeActionPreview, 'school' | 'actionTags' | 'likelyEnemyId' | 'likelyEnemyName' | 'weakPointMatch'>;

function buildEncounterPromptSection(ctx: EncounterPreviewContext): string {
  if (ctx.activeEnemies.length === 0) {
    return '';
  }
  const lines = ctx.activeEnemies.map(e => {
    const weaknesses = e.weaknesses.filter(w => w.revealed && !w.broken);
    const wStr = weaknesses.length > 0
      ? `revealed weaknesses: ${weaknesses.map(w => `${w.label} (id=${w.id})`).join(', ')}`
      : 'no revealed weaknesses';
    return `  - ${e.name} (id=${e.id}): ${wStr}`;
  });
  return `\nActive encounter enemies:\n${lines.join('\n')}\n`;
}

function parseEncounterFields(parsed: Record<string, unknown>, ctx: EncounterPreviewContext | null): PreviewEncounterFields {
  if (!ctx) {
    return {};
  }
  const VALID_SCHOOLS = ['fire', 'frost', 'light', 'shadow', 'nature', 'storm', 'mind', 'force', 'holy', 'mechanical'] as const;
  const school = VALID_SCHOOLS.find(s => parsed.school === s) ?? null;
  const actionTags = Array.isArray(parsed.actionTags)
    ? (parsed.actionTags as unknown[]).filter((t): t is string => typeof t === 'string')
    : undefined;
  const likelyEnemyId = typeof parsed.likelyEnemyId === 'string' ? parsed.likelyEnemyId : undefined;
  const likelyEnemy = likelyEnemyId ? ctx.activeEnemies.find(e => e.id === likelyEnemyId) : undefined;
  const likelyEnemyName = likelyEnemy?.name ?? (typeof parsed.likelyEnemyName === 'string' ? parsed.likelyEnemyName : undefined);
  let weakPointMatch: FreeActionPreview['weakPointMatch'] = null;
  if (
    parsed.weakPointMatch &&
    typeof (parsed.weakPointMatch as Record<string, unknown>).label === 'string' &&
    typeof (parsed.weakPointMatch as Record<string, unknown>).description === 'string'
  ) {
    const wp = parsed.weakPointMatch as { label: string; description: string };
    weakPointMatch = { label: wp.label.trim(), description: wp.description.trim() };
  }
  return {
    ...(school !== undefined && { school }),
    ...(actionTags && actionTags.length > 0 && { actionTags }),
    ...(likelyEnemyId && { likelyEnemyId }),
    ...(likelyEnemyName && { likelyEnemyName }),
    ...(weakPointMatch !== undefined && { weakPointMatch }),
  };
}

export async function previewFreeAction(
  sessionId: string,
  input: { action?: string; context?: PreviewActionContext; encounterContext?: EncounterPreviewContext | null },
): Promise<SessionActionStatSuggestion & { narration?: string; interpretedAction?: string; generatedAction?: string } & PreviewEncounterFields> {
  const { action, context, encounterContext } = input;
  const session = await StateService.getSession(sessionId);
  if (!session) {
    return { stat: 'mischief' };
  }
  const character = session.party.find(c => c.id === session.activeCharacterId) ?? session.party[0] ?? null;

  // Bonuses for caller-supplied action are computed before the LLM call.
  // For generated action they are computed after, once we have the text.
  let bonusPreview = action && character
    ? toFreeActionBonusPreview(inferFreeActionBonuses(action, character, session))
    : {};

  const storyContext = await buildFreeActionStoryContext(sessionId);
  const ctx = encounterContext ?? null;
  const encounterSection = ctx ? buildEncounterPromptSection(ctx) : '';
  const hasEncounter = !!encounterSection;
  const needsGeneratedAction = !action && !!context;

  let prompt: string;
  if (needsGeneratedAction) {
    const target = context.targetCharacterId
      ? session.party.find(c => c.id === context.targetCharacterId)
      : null;
    const itemOwner = context.itemOwnerCharacterId
      ? session.party.find(c => c.id === context.itemOwnerCharacterId)
      : character;
    const item = context.itemId
      ? itemOwner?.inventory.find(i => i.id === context.itemId)
      : null;
    const targetLine = target && context.intent !== 'party_boost'
      ? `Target ally: ${target.name}, ${target.species} ${target.class}, stats might ${target.stats.might}, magic ${target.stats.magic}, mischief ${target.stats.mischief}.`
      : '';
    const itemLine = item && itemOwner
      ? `Target gear: ${itemOwner.name}'s ${item.name}. Description: ${item.description}. Effect: ${item.effect ?? 'none'}. Tags: ${(item.tags ?? []).join(', ') || 'none'}.`
      : '';
    const targetInstruction = context.intent === 'party_boost'
      ? ' Address the whole group (everyone, all allies) - never name a single character.'
      : target ? ` Name ${target.name} as the target.` : '';
    const itemInstruction = item ? ` Reference ${item.name}.` : '';

    prompt = `${describeActiveCharacter(character)}
Intent: ${context.intent ?? 'custom'}
Method: ${context.method ?? 'none'}
${targetLine}
${itemLine}
${storyContext ? `\nCurrent story context:\n${storyContext}\n` : ''}
${encounterSection}
Write a short action sentence (8-18 words) that fits the intent and the current scene.${targetInstruction}${itemInstruction} Avoid promising success. Then analyze it.
Stat guide: might = physical/combat/force, magic = spells/arcane/healing/divine, mischief = stealth/trickery/charm/persuasion.${hasEncounter ? '\nWeakness labels are flavorful display text. Keep the exact label from the encounter data. Only set weakPointMatch when a revealed, non-broken weakness clearly matches this action\'s school or tags. Use "may exploit" wording when confidence is low.' : ''}

Reply with JSON:
{
  "generatedAction": "<action sentence, 8-18 words>",
  "stat": "might" | "magic" | "mischief",
  "narration": "<one short evocative sentence, 8-14 words>"${hasEncounter ? `,
  "school": "<magic school: fire|frost|light|shadow|nature|storm|mind|force|holy|mechanical|null>",
  "actionTags": ["<optional descriptive tags>"],
  "likelyEnemyId": "<id of likely targeted enemy, or null>",
  "likelyEnemyName": "<name of likely target enemy, or null>",
  "weakPointMatch": {"label": "<exact weakness label>", "description": "<'exploits X' or 'may exploit X' if uncertain>"} | null` : ''}
}`;
  } else {
    prompt = `${describeActiveCharacter(character)} wants to: "${action}".
${storyContext ? `\nUse this story context so the preview fits the current scene without spoiling the result:\n${storyContext}\n` : ''}
${encounterSection}
Stat guide: might = physical/combat/force, magic = spells/arcane/healing/divine, mischief = stealth/trickery/charm/persuasion.${hasEncounter ? '\nWeakness labels are flavorful display text. Keep the exact label from the encounter data; do not rewrite it to a generic school. Only set weakPointMatch when a revealed, non-broken weakness on the likely target clearly matches this action\'s school or tags. Use "may exploit" wording when confidence is low.' : ''}

Reply with JSON:
{
  "action": "<polished first-person or third-person action sentence, preserving the player's intent>",
  "stat": "might" | "magic" | "mischief",
  "narration": "<one short evocative sentence, 8-14 words, describing what the character does>"${hasEncounter ? `,
  "school": "<magic school this action uses: fire|frost|light|shadow|nature|storm|mind|force|holy|mechanical|null>",
  "actionTags": ["<optional descriptive tags>"],
  "likelyEnemyId": "<id of the enemy most likely targeted, or null>",
  "likelyEnemyName": "<name of likely target enemy, or null>",
  "weakPointMatch": {"label": "<exact free-form weakness label from encounter data>", "description": "<'exploits X weakness' or 'may exploit X weakness' if uncertain>"} | null` : ''}
}`;
  }

  const { client, model } = createChatClientForTier('preview');
  const start = Date.now();
  try {
    devLog.log(`[PreviewAction] llm-start session=${sessionId} model=${model} promptChars=${prompt.length} hasEncounter=${hasEncounter} needsGeneratedAction=${needsGeneratedAction}`);
    const response = await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      max_tokens: needsGeneratedAction ? (hasEncounter ? 220 : 120) : (hasEncounter ? 160 : 80),
    }, { signal: AbortSignal.timeout(8_000) });
    devLog.log(`[PreviewAction] llm-done session=${sessionId} model=${model} durationMs=${Date.now() - start}`);
    const raw = (response.choices[0].message.content ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
      const stat = (['might', 'magic', 'mischief'] as const).find(s => parsed.stat === s) ?? 'mischief';
      const narration = typeof parsed.narration === 'string' ? parsed.narration.trim() : undefined;
      const encounterFields = parseEncounterFields(parsed, ctx);

      if (needsGeneratedAction) {
        const generatedAction = typeof parsed.generatedAction === 'string' && parsed.generatedAction.trim()
          ? parsed.generatedAction.trim()
          : fallbackActionForIntent(character, context);
        if (character) {
          bonusPreview = toFreeActionBonusPreview(inferFreeActionBonuses(generatedAction, character, session));
        }
        return { stat, generatedAction, narration, ...bonusPreview, ...encounterFields };
      }

      const interpretedAction = typeof parsed.action === 'string' ? parsed.action.trim() : undefined;
      return { stat, ...(interpretedAction && { interpretedAction }), narration, ...bonusPreview, ...encounterFields };
    }
    const stat = (['might', 'magic', 'mischief'] as const).find(s => raw.includes(s)) ?? 'mischief';
    if (needsGeneratedAction) {
      const generatedAction = fallbackActionForIntent(character, context);
      if (character) {
        bonusPreview = toFreeActionBonusPreview(inferFreeActionBonuses(generatedAction, character, session));
      }
      return { stat, generatedAction, ...bonusPreview };
    }
    return { stat, ...bonusPreview };
  } catch (error: unknown) {
    const err = error as { name?: string; status?: number; code?: string; type?: string };
    devLog.log(`[PreviewAction] llm-error session=${sessionId} model=${model} durationMs=${Date.now() - start} name=${err.name ?? 'unknown'} status=${err.status ?? 'n/a'} code=${err.code ?? 'n/a'} type=${err.type ?? 'n/a'}`);
    if (needsGeneratedAction) {
      const generatedAction = fallbackActionForIntent(character, context);
      if (character) {
        bonusPreview = toFreeActionBonusPreview(inferFreeActionBonuses(generatedAction, character, session));
      }
      return { stat: 'mischief', generatedAction, ...bonusPreview };
    }
    return { stat: 'mischief', ...bonusPreview };
  }
}

function buildEncounterContextFromEnemies(enemies: EncounterEnemy[]): EncounterPreviewContext {
  return {
    activeEnemies: enemies
      .filter(e => e.status === 'active')
      .map(e => ({
        id: e.id,
        name: e.name,
        weaknesses: (e.weaknesses ?? []).map(w => ({
          id: w.id,
          label: w.label,
          school: w.school,
          revealed: w.revealed,
          broken: w.broken,
        })),
      })),
  };
}

export { buildEncounterContextFromEnemies };

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

  const { client, model } = createChatClientForTier('preview');
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
