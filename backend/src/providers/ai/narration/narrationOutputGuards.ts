import type { NarrationInput, NarrationOutput } from './NarrationProvider.js';
import { narrationOutputSchema } from './narrationSchemas.js';

const HEALING_ACTION_RE = /\b(heal|healing|restore|restoring|revive|reviving|mend|mending|soothe|soothing|recover|recovery|rest|resting|sleep|sleeping|eat|eating|meal|care|treat|treating|medicine|potion|bandage|sanctuary)\b/i;
const LOW_MOTION_RE = /\b(inspect|wait|look around|look|listen|rest|discuss|search)\b/i;
const GENERIC_LABEL_RE = /\b(attack|strike|search|inspect|look|wait|listen|rest|discuss)\b/i;
const CONCRETE_TRANSITION_RE = /\b(stair|stairs|door|gate|path|paths|pathway|pathways|trail|route|bridge|ferry|passage|tunnel|portal|shortcut|chamber|room|cave|cavern|tower|map|key|clue|clues|symbol|symbols|hazard|hazards|danger|dangers|guide|track|tracks|smoke|light|opens?|deeper|beyond|toward|descend|descends|enter|arrive|follow)\b/i;
const COMBAT_LABEL_RE = /\b(attack|strike|slash|stab|fight|battle|enemy|foe|monster|goblin|wolf|wolves)\b/i;
const PORTAL_TRANSITION_RE = /\b(portal|teleport|teleports|teleported|teleporting|gateway|gateways|waygate|waygates)\b/i;
const VAGUE_ATMOSPHERE_PHRASES = [
  'tension in the air',
  'tension hangs in the air',
  'the air grows tense',
  'an eerie silence falls',
  'shadows loom',
  'the corridor waits',
];
const SIMILARITY_STOPWORDS = new Set([
  'about',
  'after',
  'again',
  'before',
  'being',
  'into',
  'itself',
  'must',
  'over',
  'party',
  'their',
  'them',
  'then',
  'there',
  'these',
  'they',
  'this',
  'those',
  'through',
  'toward',
  'under',
  'where',
  'which',
  'while',
  'with',
]);

const normalizedItemName = (name: string | undefined): string => {
  const trimmed = (name ?? '').trim();
  const [firstChar] = Array.from(trimmed);
  const withoutLeadingEmoji = firstChar && /\p{Extended_Pictographic}/u.test(firstChar)
    ? trimmed.slice(firstChar.length).trim()
    : trimmed;
  return withoutLeadingEmoji.toLowerCase().replace(/\s+/g, ' ');
};

const normalizedText = (text: string): string => text.toLowerCase().replace(/[^\p{Letter}\p{Number}]+/gu, ' ').replace(/\s+/g, ' ').trim();

const significantTokens = (text: string): Set<string> => new Set(
  normalizedText(text)
    .split(' ')
    .filter(token => token.length >= 4 && !SIMILARITY_STOPWORDS.has(token))
);

function narrationSimilarity(a: string, b: string): { shared: number; score: number } {
  const aTokens = significantTokens(a);
  const bTokens = significantTokens(b);
  if (aTokens.size === 0 || bTokens.size === 0) {
    return { shared: 0, score: 0 };
  }

  const shared = [...aTokens].filter(token => bTokens.has(token)).length;
  const union = new Set([...aTokens, ...bTokens]).size;
  return { shared, score: shared / union };
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

function validateMomentumOutput(input: NarrationInput, output: NarrationOutput): string | null {
  const momentum = input.sceneMomentum;
  if (!momentum) {
    return null;
  }

  const choiceText = output.choices.map(choice => `${choice.label} ${choice.narration ?? ''}`).join(' ');
  const fullText = `${output.narration} ${choiceText}`;
  const hasPortalTransition = PORTAL_TRANSITION_RE.test(fullText);
  const completedMajorBeat = momentum.justCompletedCombat || momentum.justCompletedDifficultChallenge;

  if (hasPortalTransition && !completedMajorBeat) {
    return 'Portal, teleport, or magical gateway transitions require this turn to complete combat or a difficult challenge.';
  }

  if (momentum.directive === 'victory_exit') {
    const choicesInNewBeat = output.choices.filter(choice => CONCRETE_TRANSITION_RE.test(`${choice.label} ${choice.narration ?? ''}`)).length;
    const allChoicesStillCombat = output.choices.every(choice => COMBAT_LABEL_RE.test(`${choice.label} ${choice.narration ?? ''}`));
    const combatChoiceCount = output.choices.filter(choice => COMBAT_LABEL_RE.test(`${choice.label} ${choice.narration ?? ''}`)).length;
    if (!CONCRETE_TRANSITION_RE.test(fullText) || choicesInNewBeat < 2 || allChoicesStillCombat || combatChoiceCount > 1) {
      return 'Victory exit must move the party into a new beat, and at least two choices must act inside that new beat. No more than one choice may read as another attack.';
    }
  }

  if (momentum.directive === 'advance_campaign' && output.choices.every(choice => LOW_MOTION_RE.test(choice.label) && !CONCRETE_TRANSITION_RE.test(`${choice.label} ${choice.narration ?? ''}`))) {
    return 'Advance-campaign choices cannot all be low-motion actions without concrete objects, routes, NPCs, hazards, or items.';
  }

  const narrationNormalized = normalizedText(output.narration);
  const recentNormalized = normalizedText(input.recentHistory.join(' '));
  const repeatedFluff = VAGUE_ATMOSPHERE_PHRASES.find(phrase =>
    narrationNormalized.includes(normalizedText(phrase)) &&
    recentNormalized.includes(normalizedText(phrase))
  );
  if (repeatedFluff) {
    return `Narration repeats vague atmosphere filler: "${repeatedFluff}". Preserve concrete continuity instead.`;
  }

  const repeatedNarration = input.recentHistory
    .map(previous => ({ previous, ...narrationSimilarity(previous, output.narration) }))
    .find(result => result.shared >= 20 && result.score >= 0.4);
  if (repeatedNarration) {
    return 'Narration repeats the previous turn too closely. Continue from the current action instead of restating the same scene setup.';
  }

  const previousLabels = new Set((input.previousChoiceLabels ?? []).map(normalizedText));
  const repeatedGenericChoice = output.choices.find(choice => {
    const label = normalizedText(choice.label);
    return previousLabels.has(label) && GENERIC_LABEL_RE.test(label);
  });
  if (repeatedGenericChoice) {
    return `Choice label repeats stale generic action: "${repeatedGenericChoice.label}". Use a specific verb and concrete object.`;
  }

  return null;
}

export function parseNarrationOutput(input: NarrationInput, raw: unknown): { success: true; data: NarrationOutput } | { success: false; error: string } {
  const parsed = narrationOutputSchema.safeParse(raw);
  if (!parsed.success) {
    return { success: false, error: parsed.error.message };
  }

  canonicalizeItemChoices(input, parsed.data);
  normalizeNarrationMetadata(input, parsed.data);
  const momentumError = validateMomentumOutput(input, parsed.data);
  if (momentumError) {
    return { success: false, error: momentumError };
  }

  return { success: true, data: parsed.data };
}
