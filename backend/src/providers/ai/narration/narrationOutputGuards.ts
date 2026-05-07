import type { NarrationInput, NarrationOutput } from './NarrationProvider.js';
import { narrationOutputSchema } from './narrationSchemas.js';

const HEALING_ACTION_RE = /\b(heal|healing|restore|restoring|revive|reviving|mend|mending|soothe|soothing|recover|recovery|rest|resting|sleep|sleeping|eat|eating|meal|care|treat|treating|medicine|potion|bandage|sanctuary)\b/i;

const normalizedItemName = (name: string | undefined): string => {
  const trimmed = (name ?? '').trim();
  const [firstChar] = Array.from(trimmed);
  const withoutLeadingEmoji = firstChar && /\p{Extended_Pictographic}/u.test(firstChar)
    ? trimmed.slice(firstChar.length).trim()
    : trimmed;
  return withoutLeadingEmoji.toLowerCase().replace(/\s+/g, ' ');
};

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

function normalizeNarrationMetadata(input: NarrationInput, output: NarrationOutput): void {
  if (input.gameMode === 'zug-ma-geddon' || input.scenePressure?.kind === 'combat') {
    output.currentTensionLevel = 'high';
  }

  if (output.suggestedHeal?.length && !HEALING_ACTION_RE.test(input.actionAttempt)) {
    output.suggestedHeal = null;
  }

  for (const choice of output.choices) {
    if (choice.flavor === 'environment' && !choice.environmentFeature) {
      choice.flavor = 'standard';
    }

    if (choice.flavor === 'combo') {
      const helper = input.party.find(c => c.name === choice.helperCharacterName);
      if (!helper || helper.status !== 'active' || helper.name === input.nextCharacterName) {
        choice.flavor = 'standard';
        delete choice.helperCharacterName;
      }
    }
  }
}

export function parseNarrationOutput(input: NarrationInput, raw: unknown): { success: true; data: NarrationOutput } | { success: false; error: string } {
  const parsed = narrationOutputSchema.safeParse(raw);
  if (!parsed.success) {
    return { success: false, error: parsed.error.message };
  }

  canonicalizeItemChoices(input, parsed.data);
  normalizeNarrationMetadata(input, parsed.data);

  return { success: true, data: parsed.data };
}
