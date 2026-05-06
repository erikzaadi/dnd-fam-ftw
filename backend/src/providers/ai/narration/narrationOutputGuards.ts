import type { NarrationInput, NarrationOutput } from './NarrationProvider.js';
import { narrationOutputSchema } from './narrationSchemas.js';

const PORTAL_CHOICE_RE = /\b(portal|shortcut|teleport|teleportation|gateway|rift|waygate)\b/i;
const CHALLENGE_ACTION_RE = /\b(ambush|battle|boss|brawl|challenge|chase|combat|conflict|defeat|disarm|duel|enemy|escape|fight|foe|guard|guardian|hazard|monster|obstacle|puzzle|riddle|ritual|shadow|shadows|sneak|spectral|strike|trap|wolf|wolves)\b/i;
const HEALING_ACTION_RE = /\b(heal|healing|restore|restoring|revive|reviving|mend|mending|soothe|soothing|recover|recovery|rest|resting|sleep|sleeping|eat|eating|meal|care|treat|treating|medicine|potion|bandage|sanctuary)\b/i;

const choiceText = (choice: NarrationOutput['choices'][number]) => `${choice.label} ${choice.narration ?? ''}`;
const normalizedItemName = (name: string | undefined): string => {
  const trimmed = (name ?? '').trim();
  const [firstChar] = Array.from(trimmed);
  const withoutLeadingEmoji = firstChar && /\p{Extended_Pictographic}/u.test(firstChar)
    ? trimmed.slice(firstChar.length).trim()
    : trimmed;
  return withoutLeadingEmoji.toLowerCase().replace(/\s+/g, ' ');
};

function hasPortalChoice(output: NarrationOutput): boolean {
  return output.choices.some(choice => PORTAL_CHOICE_RE.test(choiceText(choice)));
}

function inputHasChallengeContext(input: NarrationInput): boolean {
  const context = [
    input.actionAttempt,
    input.actionResult.summary,
    input.scene,
    input.storySummary,
    ...(input.recentHistory ?? []),
  ].join(' ');
  return CHALLENGE_ACTION_RE.test(context);
}

function completedPortalWorthyChallenge(input: NarrationInput): boolean {
  if (!input.actionResult.success || HEALING_ACTION_RE.test(input.actionAttempt)) {
    return false;
  }

  const impact = input.actionResult.impact;
  const completedStrongOutcome = impact === 'strong' || impact === 'extreme';
  const completedDifficultRoll = (input.actionResult.difficultyTarget ?? 0) >= 13;
  return completedStrongOutcome || completedDifficultRoll || inputHasChallengeContext(input);
}

function canonicalizeItemChoices(input: NarrationInput, output: NarrationOutput): void {
  for (const choice of output.choices) {
    if (choice.flavor !== 'item') {
      continue;
    }

    const item = input.inventory.find(i =>
      i.ownerName === choice.itemOwnerName &&
      normalizedItemName(i.name) === normalizedItemName(choice.itemName)
    );
    if (item) {
      choice.itemOwnerName = item.ownerName;
      choice.itemName = item.name;
      continue;
    }

    choice.flavor = 'standard';
    delete choice.itemOwnerName;
    delete choice.itemName;
  }
}

export function validateNarrationOutput(input: NarrationInput, output: NarrationOutput): string[] {
  const errors: string[] = [];
  if (hasPortalChoice(output) && !completedPortalWorthyChallenge(input)) {
    errors.push('Portal, shortcut, or teleport choices require this turn to complete combat or a difficult challenge.');
  }

  if ((input.gameMode === 'zug-ma-geddon') && output.currentTensionLevel !== 'high') {
    errors.push('zug-ma-geddon turns must keep currentTensionLevel high.');
  }

  if (output.suggestedHeal?.length && !HEALING_ACTION_RE.test(input.actionAttempt)) {
    errors.push('suggestedHeal requires an explicitly healing, rest, care, or recovery action.');
  }

  for (const choice of output.choices) {
    if (choice.flavor === 'combo') {
      const helper = input.party.find(c => c.name === choice.helperCharacterName);
      if (!helper || helper.status !== 'active' || helper.name === input.nextCharacterName) {
        errors.push('Combo choices must include helperCharacterName for an active ally.');
      }
    }

    if (choice.flavor === 'item') {
      const item = input.inventory.find(i => i.ownerName === choice.itemOwnerName && i.name === choice.itemName);
      if (!item) {
        errors.push('Item choices must reference an existing itemOwnerName and itemName from inventory.');
      }
    }

    if (choice.flavor === 'environment' && !choice.environmentFeature) {
      errors.push('Environment choices must include environmentFeature.');
    }
  }

  return errors;
}

export function parseNarrationOutput(input: NarrationInput, raw: unknown): { success: true; data: NarrationOutput } | { success: false; error: string } {
  const parsed = narrationOutputSchema.safeParse(raw);
  if (!parsed.success) {
    return { success: false, error: parsed.error.message };
  }

  canonicalizeItemChoices(input, parsed.data);
  const guardErrors = validateNarrationOutput(input, parsed.data);
  if (guardErrors.length > 0) {
    return { success: false, error: guardErrors.join(' ') };
  }

  return { success: true, data: parsed.data };
}
