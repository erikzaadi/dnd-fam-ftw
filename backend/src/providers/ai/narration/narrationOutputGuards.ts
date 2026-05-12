import type { NarrationInput, NarrationOutput } from './NarrationProvider.js';
import { narrationOutputSchema, type ValidNarrationOutput } from './narrationSchemas.js';

const HEALING_ACTION_RE = /\b(heal|healing|restore|restoring|revive|reviving|mend|mending|soothe|soothing|recover|recovery|rest|resting|sleep|sleeping|eat|eating|meal|care|treat|treating|medicine|potion|bandage|sanctuary)\b/i;
const LOW_MOTION_RE = /\b(inspect|wait|look around|look|listen|rest|discuss|search)\b/i;
const GENERIC_LABEL_RE = /\b(attack|strike|search|inspect|look|wait|listen|rest|discuss)\b/i;
const CONCRETE_TRANSITION_RE = /\b(stair|stairs|door|gate|path|paths|pathway|pathways|trail|route|bridge|ferry|passage|tunnel|portal|shortcut|chamber|room|cave|cavern|tower|map|key|clue|clues|symbol|symbols|hazard|hazards|danger|dangers|guide|track|tracks|smoke|light|opens?|deeper|beyond|toward|descend|descends|enter|arrive|follow)\b/i;
const COMBAT_LABEL_RE = /\b(attack|strike|slash|stab|fight|battle|enemy|foe|monster|goblin|wolf|wolves)\b/i;
const PORTAL_TRANSITION_RE = /\b(portal|teleport|teleports|teleported|teleporting|gateway|gateways|waygate|waygates)\b/i;
const HIDDEN_PATH_RE = /\b(hidden|secret|concealed|veiled)\b.{0,24}\b(path|paths|trail|route|passage|tunnel|door|doorway)\b/i;
const RESOLVED_THREAT_RE = /\b(defeated|vanquished|banished|calmed|retreats?|retreated|dissipates?|dissipated|dissolves?|dissolved|fades?|faded|clears?|cleared|silenced|gone)\b/i;
const REVIVED_THREAT_RE = /\b(ambush|attack|attacks|battle|block|blocks|burst|bursts|confront|confronts|danger|emerges?|fight|growl|hungry|lunges?|menacing|menace|ready to fight|revenge|returns?|shadow|shadows|strike|threat|vengeful|writhes?|writhing)\b/i;
const THREAT_PHRASE_RE = /\b(?:shadowy|spectral|twisted|vengeful|massive|mechanical|vine|wolf|guardian|shadow|root|clockwork)\s+(?:figure|creature|wolf|guardian|menace|beast|roots?|vines?)\b/gi;
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

const normalizedItemName = (name: string | null | undefined): string => {
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

function resolvedThreatPhrases(input: NarrationInput): Set<string> {
  const sourceTexts = [
    input.storySummary ?? '',
    ...input.recentHistory,
  ];
  const phrases = new Set<string>();

  for (const text of sourceTexts) {
    if (!RESOLVED_THREAT_RE.test(text)) {
      continue;
    }

    for (const match of text.matchAll(THREAT_PHRASE_RE)) {
      phrases.add(normalizedText(match[0]));
    }
  }

  return phrases;
}

function repeatsResolvedThreat(input: NarrationInput, outputText: string): string | null {
  const outputNormalized = normalizedText(outputText);
  const outputIsThreatening = REVIVED_THREAT_RE.test(outputText);
  if (!outputIsThreatening) {
    return null;
  }

  for (const phrase of resolvedThreatPhrases(input)) {
    if (phrase && outputNormalized.includes(phrase)) {
      return phrase;
    }
  }

  return null;
}

function canonicalizeItemChoices(input: NarrationInput, output: ValidNarrationOutput): void {
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

function normalizeNarrationMetadata(input: NarrationInput, output: ValidNarrationOutput): void {
  if (input.gameMode === 'zug-ma-geddon' || input.scenePressure?.kind === 'combat') {
    output.currentTensionLevel = 'high';
  }

  if (output.suggestedHeal?.length && !HEALING_ACTION_RE.test(input.actionAttempt)) {
    output.suggestedHeal = null;
  }

  if (output.suggestedBuffAdd) {
    const target = input.party.find(c => c.name === output.suggestedBuffAdd?.characterName);
    if (!target || target.status !== 'active') {
      output.suggestedBuffAdd = null;
    } else {
      output.suggestedBuffAdd.characterName = target.name;
    }
  }

  if (output.suggestedBuffRemove) {
    const target = input.party.find(c => c.name === output.suggestedBuffRemove?.characterName);
    if (!target) {
      output.suggestedBuffRemove = null;
    } else {
      output.suggestedBuffRemove.characterName = target.name;
    }
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

function replaceEmDashes(value: string): string {
  return value.replace(/[—]/g, '-');
}

function stripNarrationEmDashes(output: ValidNarrationOutput): void {
  output.narration = replaceEmDashes(output.narration);
  if (output.rollNarration) {
    output.rollNarration = replaceEmDashes(output.rollNarration);
  }
  if (output.imagePrompt) {
    output.imagePrompt = replaceEmDashes(output.imagePrompt);
  }

  for (const choice of output.choices) {
    choice.label = replaceEmDashes(choice.label);
    if (choice.narration) {
      choice.narration = replaceEmDashes(choice.narration);
    }
    if (choice.riddleAnswer) {
      choice.riddleAnswer = replaceEmDashes(choice.riddleAnswer);
    }
    if (choice.environmentFeature) {
      choice.environmentFeature = replaceEmDashes(choice.environmentFeature);
    }
  }
}

function validateMomentumOutput(input: NarrationInput, output: ValidNarrationOutput): string | null {
  const momentum = input.sceneMomentum;
  const choiceText = output.choices.map(choice => `${choice.label} ${choice.narration ?? ''}`).join(' ');
  const fullText = `${output.narration} ${choiceText}`;

  if (momentum) {
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

  const repeatedResolvedThreat = repeatsResolvedThreat(input, fullText);
  if (repeatedResolvedThreat) {
    return `Output revives recently resolved threat: "${repeatedResolvedThreat}". Move to a different beat, consequence, clue, NPC, or location.`;
  }

  const hiddenPathLoop = HIDDEN_PATH_RE.test(fullText) && input.recentHistory.some(previous => HIDDEN_PATH_RE.test(previous));
  if (hiddenPathLoop) {
    return 'Hidden-path beat repeats recent story continuity. Pay off the discovered route or introduce a different concrete obstacle, clue, NPC, or location.';
  }

  const previousLabels = new Set((input.previousChoiceLabels ?? []).map(normalizedText));
  const offOwnerItemChoice = output.choices.find(choice =>
    choice.flavor === 'item' &&
    choice.itemOwnerName &&
    input.nextCharacterName &&
    choice.itemOwnerName !== input.nextCharacterName
  );
  if (offOwnerItemChoice?.itemOwnerName) {
    return `Item choice uses gear from "${offOwnerItemChoice.itemOwnerName}", but the next actor is "${input.nextCharacterName}". Item choices may only use the next actor's own gear.`;
  }

  const repeatedGenericChoice = output.choices.find(choice => {
    const label = normalizedText(choice.label);
    return previousLabels.has(label) && GENERIC_LABEL_RE.test(label);
  });
  if (repeatedGenericChoice) {
    return `Choice label repeats stale generic action: "${repeatedGenericChoice.label}". Use a specific verb and concrete object.`;
  }

  const repeatedExactChoice = output.choices.find(choice => {
    const label = normalizedText(choice.label);
    return label.length > 0 && previousLabels.has(label);
  });
  if (repeatedExactChoice) {
    return `Choice label repeats the previous turn exactly: "${repeatedExactChoice.label}". Continue the scene with a fresh specific action.`;
  }

  const previousItemNames = new Set((input.previousChoiceItemNames ?? []).map(normalizedItemName));
  const repeatedItemChoice = output.choices.find(choice =>
    choice.flavor === 'item' &&
    choice.itemName &&
    previousItemNames.has(normalizedItemName(choice.itemName))
  );
  if (repeatedItemChoice?.itemName) {
    return `Item choice repeats recently suggested gear: "${repeatedItemChoice.itemName}". Use a different item, route, NPC, obstacle, or standard action.`;
  }

  return null;
}

export function parseNarrationOutput(
  input: NarrationInput,
  raw: unknown,
  options: { enforceGameplayGuards?: boolean } = {},
): { success: true; data: NarrationOutput } | { success: false; error: string } {
  const enforceGameplayGuards = options.enforceGameplayGuards ?? true;
  const parsed = narrationOutputSchema.safeParse(raw);
  if (!parsed.success) {
    return { success: false, error: parsed.error.message };
  }

  stripNarrationEmDashes(parsed.data);
  canonicalizeItemChoices(input, parsed.data);
  normalizeNarrationMetadata(input, parsed.data);
  if (enforceGameplayGuards) {
    const momentumError = validateMomentumOutput(input, parsed.data);
    if (momentumError) {
      return { success: false, error: momentumError };
    }
  }

  // The schema uses .nullable() on optional fields for OpenAI Structured Outputs compatibility.
  // NarrationOutput uses undefined for those optionals; all callers use truthy checks so null is safe.
  return { success: true, data: parsed.data as unknown as NarrationOutput };
}
