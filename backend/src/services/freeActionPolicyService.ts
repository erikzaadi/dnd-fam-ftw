import type { ActionAttempt, Difficulty, SessionState, TurnResult } from '../types.js';

const HEALING_ACTION_RE = /\b(heal|healing|restore|restoring|revive|reviving|mend|mending|soothe|soothing|recover|recovery|rest|resting|sleep|sleeping|eat|eating|meal|care|treat|treating|medicine|potion|bandage|sanctuary)\b/i;
const ENCHANT_ACTION_RE = /\b(enchant|enchanting|bless|blessing|empower|empowering|infuse|infusing|imbue|imbuing|charge|charging|strengthen|strengthening|upgrade|upgrading)\b/i;
const PARTY_WIDE_RE = /\b(party|everyone|everybody|all|whole group|the group|the team|teammates|friends|allies|share|shared|together|feast|meal)\b/i;
const SIMPLE_PATH_ACTION_RE = /\b(follow|take|walk|go|move|head|continue|proceed)\b.*\b(path|paths|trail|route|road|track|tracks|passage|tunnel|corridor|hallway)\b/i;

const searchable = (text: string | undefined): string => (text ?? '')
  .toLowerCase()
  .normalize('NFKD')
  .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const containsSearchable = (haystack: string, needle: string | undefined): boolean => {
  const normalizedNeedle = searchable(needle);
  return normalizedNeedle.length > 1 && haystack.includes(normalizedNeedle);
};

function actionReferencesItem(action: string, itemName: string): boolean {
  const normalizedName = searchable(itemName);
  if (containsSearchable(action, normalizedName)) {
    return true;
  }

  return normalizedName
    .split(' ')
    .filter(part => part.length > 2)
    .some(part => action.includes(part));
}

export function isHealingFreeAction(action: string): boolean {
  return HEALING_ACTION_RE.test(action);
}

export function getFreeActionDifficulty(action: string): { difficulty: Difficulty; difficultyValue?: number } {
  if (SIMPLE_PATH_ACTION_RE.test(action)) {
    return { difficulty: 'easy', difficultyValue: 7 };
  }

  if (isHealingFreeAction(action)) {
    return { difficulty: 'easy', difficultyValue: 8 };
  }

  return { difficulty: 'normal' };
}

export function buildFreeActionWarnings(action: string, session: SessionState): string[] {
  const warnings: string[] = [];

  if (isHealingFreeAction(action)) {
    const injured = session.party.filter(c => c.status === 'active' && c.hp < c.max_hp);
    const downed = session.party.filter(c => c.status === 'downed');
    if (injured.length > 0 || downed.length > 0) {
      warnings.push('Healing intent detected. A successful roll will restore a hurt or downed party member.');
    } else {
      warnings.push('Healing intent detected, but no party member is currently hurt.');
    }
  }

  const enchantmentTarget = findEnchantmentTarget(action, session);
  if (enchantmentTarget) {
    warnings.push(`Enchantment target detected: ${enchantmentTarget.owner.name}'s ${enchantmentTarget.item.name}.`);
  }

  return warnings;
}

export function ensureSuccessfulHealingSuggestion(
  session: SessionState,
  actionAttempt: ActionAttempt,
  turnResult: TurnResult,
): TurnResult {
  if (!isHealingFreeAction(actionAttempt.actionAttempt) || !actionAttempt.actionResult.success) {
    return turnResult;
  }

  const hasHeal = Array.isArray(turnResult.suggestedHeal) && turnResult.suggestedHeal.length > 0;
  const hasRevive = !!turnResult.suggestedRevive;
  if (hasHeal || hasRevive) {
    return turnResult;
  }

  const partyWide = PARTY_WIDE_RE.test(actionAttempt.actionAttempt);
  const activeInjured = session.party.filter(c => c.status === 'active' && c.hp < c.max_hp);
  const downed = session.party.filter(c => c.status === 'downed');
  const impact = actionAttempt.actionResult.impact;
  const healAmount = impact === 'extreme' ? 6 : impact === 'strong' ? 4 : 2;
  const reviveHp = impact === 'extreme' ? 5 : impact === 'strong' ? 4 : 3;

  const suggestedHeal = partyWide
    ? activeInjured.map(c => ({ characterName: c.name, hp: healAmount }))
    : activeInjured
      .sort((a, b) => (a.hp / a.max_hp) - (b.hp / b.max_hp))
      .slice(0, 1)
      .map(c => ({ characterName: c.name, hp: healAmount }));

  const suggestedRevive = downed.length > 0
    ? { characterName: downed[0].name, hp: reviveHp }
    : null;

  if (suggestedHeal.length === 0 && !suggestedRevive) {
    return turnResult;
  }

  return {
    ...turnResult,
    suggestedHeal: suggestedHeal.length > 0 ? suggestedHeal : turnResult.suggestedHeal,
    suggestedRevive: suggestedRevive ?? turnResult.suggestedRevive,
  };
}

function findEnchantmentTarget(action: string, session: SessionState) {
  if (!ENCHANT_ACTION_RE.test(action)) {
    return null;
  }

  const normalizedAction = searchable(action);
  return session.party
    .flatMap(owner => owner.inventory.map(item => ({ owner, item })))
    .find(({ item }) => actionReferencesItem(normalizedAction, item.name)) ?? null;
}

export function ensureSuccessfulEnchantmentSuggestion(
  session: SessionState,
  actionAttempt: ActionAttempt,
  turnResult: TurnResult,
): TurnResult {
  if (!actionAttempt.actionResult.success || turnResult.suggestedInventoryUpdate) {
    return turnResult;
  }

  const target = findEnchantmentTarget(actionAttempt.actionAttempt, session);
  if (!target) {
    return turnResult;
  }

  const stat = actionAttempt.actionResult.statUsed === 'none' ? 'magic' : actionAttempt.actionResult.statUsed;
  const currentBonuses = target.item.statBonuses ?? {};
  const currentBonus = currentBonuses[stat] ?? 0;
  const nextBonus = Math.min(3, Math.max(currentBonus + 1, 1));
  const existingTags = target.item.tags ?? [];
  const tags = existingTags.includes('Enchanted') ? existingTags : [...existingTags, 'Enchanted'];
  const description = target.item.description.trim()
    ? `${target.item.description.trim()} It hums with a fresh enchantment.`
    : 'It hums with a fresh enchantment.';

  return {
    ...turnResult,
    suggestedInventoryUpdate: {
      characterName: target.owner.name,
      itemName: target.item.name,
      description,
      statBonuses: {
        ...currentBonuses,
        [stat]: nextBonus,
      },
      tags,
      condition: 'Enchanted',
    },
  };
}
