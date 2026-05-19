import type { NarrationInput, NarrationOutput } from './NarrationProvider.js';
import { narrationOutputSchema, type ValidNarrationOutput } from './narrationSchemas.js';
import { devLog } from '../../../lib/devLog.js';

const HEALING_ACTION_RE = /\b(heal|healing|restore|restoring|revive|reviving|mend|mending|soothe|soothing|recover|recovery|rest|resting|sleep|sleeping|eat|eating|meal|care|treat|treating|medicine|potion|bandage|sanctuary)\b/i;
const LOW_MOTION_RE = /\b(inspect|wait|look around|look|listen|rest|discuss|search)\b/i;
const GENERIC_LABEL_RE = /\b(attack|strike|search|inspect|look|wait|listen|rest|discuss)\b/i;
const CONCRETE_TRANSITION_RE = /\b(stair|stairs|door|gate|path|paths|pathway|pathways|trail|route|bridge|ferry|passage|tunnel|portal|shortcut|chamber|room|cave|cavern|tower|map|key|clue|clues|symbol|symbols|hazard|hazards|danger|dangers|guide|track|tracks|smoke|light|opens?|deeper|beyond|toward|descend|descends|enter|arrive|follow|inspect|examine|investigate|study|explore|search|speak|listen|offer|share|discover|reveal|relic|artifact|shrine|ruins|alcove|gather|ancient|glade|clearing|grove|merchant|npc|village|camp|campfire|library|tavern|market|forge|vault|altar|chest|treasure|reward|loot|bounty|signal|beacon|seal|shard|fragment|crystal|gem|stone|scroll|tome|journal|note|letter|message|riddle|puzzle|trap|mechanism|lever|rune|ward|barrier|seal)\b/i;
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
  'the climax near',
  'climax draws ever near',
  'approach is imminent',
  'presence grows near',
  'presence looms closer',
  'closing in',
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

// Distinctive substrings that should never appear in player-facing narration.
// These are fragments from suggestedNextBeat instructions and system field names
// that the AI occasionally copies verbatim into story prose.
const INSTRUCTION_LEAK_FRAGMENTS = [
  'connect this turn to the main threat',
  'push toward a climactic confrontation',
  'introduce a concrete new beat',
  'carry the party away from the defeated encounter',
  'carry the party past the completed challenge',
  'end the current fight decisively with surrender, retreat',
  'keep the current challenge active, but change the object',
  'start a concrete scene beat with a clear object',
  'use suggestedencounterstart',
  'suggestedencounterstart',
  'dmprepencounters',
  'scenemomentum',
  'suggestednextbeat',
  'has the next move',
] as const;

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

  // Include actual enemy names from recently-resolved encounters so named enemy
  // types (e.g. "Memory Wraith") are caught even when the generic regex misses them.
  for (const name of input.resolvedEncounterEnemyNames ?? []) {
    phrases.add(normalizedText(name));
  }

  return phrases;
}

function activeEncounterThreatPhrases(input: NarrationInput): Set<string> {
  const phrases = new Set<string>();
  if (input.encounterState?.status !== 'active') {
    return phrases;
  }

  for (const enemy of input.encounterState.enemies) {
    if (enemy.status !== 'active') {
      continue;
    }
    phrases.add(normalizedText(enemy.name));
    for (const alias of enemy.aliases ?? []) {
      phrases.add(normalizedText(alias));
    }
  }

  return phrases;
}

function isActiveEncounterThreatPhrase(phrase: string, activePhrases: Set<string>): boolean {
  for (const activePhrase of activePhrases) {
    if (!activePhrase) {
      continue;
    }
    if (activePhrase === phrase || activePhrase.includes(phrase) || phrase.includes(activePhrase)) {
      return true;
    }
  }
  return false;
}

function repeatsResolvedThreat(input: NarrationInput, outputText: string): string | null {
  const outputNormalized = normalizedText(outputText);
  const outputIsThreatening = REVIVED_THREAT_RE.test(outputText);
  if (!outputIsThreatening) {
    return null;
  }

  // Phrases that are substrings of inventory item names are safe to mention -
  // the item was earned from the resolved encounter and is intentionally referenceable.
  const inventoryItemPhrases = new Set(
    input.inventory.map(item => normalizedText(item.name))
  );

  const activePhrases = activeEncounterThreatPhrases(input);
  for (const phrase of resolvedThreatPhrases(input)) {
    if (isActiveEncounterThreatPhrase(phrase, activePhrases)) {
      continue;
    }
    if (phrase && outputNormalized.includes(phrase)) {
      const appearsInInventoryItem = [...inventoryItemPhrases].some(
        itemPhrase => itemPhrase.includes(phrase)
      );
      if (appearsInInventoryItem) {
        continue;
      }
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
    if (item && (!input.nextCharacterName || item.ownerName === input.nextCharacterName)) {
      choice.itemOwnerName = item.ownerName;
      choice.itemName = item.name;
      continue;
    }

    // Item missing or belongs to a character other than the next actor - degrade to standard.
    // This handles cross-character enchants where the AI wants to reference the updated item.
    devLog.warn('[Guard] item choice degraded to standard', { label: choice.label, itemName: choice.itemName, itemOwnerName: choice.itemOwnerName, nextCharacterName: input.nextCharacterName });
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
    devLog.warn('[Guard] suggestedHeal stripped - action did not match healing pattern', { actionAttempt: input.actionAttempt, healTargets: output.suggestedHeal.map(h => h.characterName) });
    output.suggestedHeal = null;
  }

  if (output.suggestedBuffAdd) {
    const before = output.suggestedBuffAdd.length;
    const validated = output.suggestedBuffAdd.flatMap(buff => {
      const target = input.party.find(c => c.name === buff.characterName);
      if (!target || target.status !== 'active') {
        devLog.warn('[Guard] suggestedBuffAdd entry dropped - invalid or downed target', { characterName: buff.characterName, buffName: buff.name });
        return [];
      }
      buff.characterName = target.name;
      return [buff];
    });
    if (validated.length < before) {
      devLog.warn('[Guard] suggestedBuffAdd filtered', { before, after: validated.length });
    }
    output.suggestedBuffAdd = validated.length > 0 ? validated : null;
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
    } else if (choice.helperCharacterName) {
      // helperCharacterName is only meaningful on combo choices
      delete choice.helperCharacterName;
    }
  }
}

const ANSI_RE = new RegExp(String.fromCharCode(0x1b) + String.raw`\[[0-9;]*[a-zA-Z]`, "g");
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_RE = /[\x00-\x1f\x7f]/g;

function cleanText(value: string): string {
  return value.replace(ANSI_RE, '').replace(CONTROL_CHARS_RE, '').replace(/[—]/g, '-');
}

function stripNarrationEmDashes(output: ValidNarrationOutput): void {
  output.narration = cleanText(output.narration);
  if (output.rollNarration) {
    output.rollNarration = cleanText(output.rollNarration);
  }
  for (const choice of output.choices) {
    choice.label = cleanText(choice.label);
    if (choice.narration) {
      choice.narration = cleanText(choice.narration);
    }
    if (choice.riddleAnswer) {
      choice.riddleAnswer = cleanText(choice.riddleAnswer);
    }
    if (choice.environmentFeature) {
      choice.environmentFeature = cleanText(choice.environmentFeature);
    }
  }
}

function validateMomentumOutput(input: NarrationInput, output: ValidNarrationOutput): string | null {
  const momentum = input.sceneMomentum;
  const choiceText = output.choices.map(choice => `${choice.label} ${choice.narration ?? ''}`).join(' ');
  const fullText = `${output.narration} ${choiceText}`;
  const nonItemChoiceText = output.choices
    .filter(choice => choice.flavor !== 'item')
    .map(choice => `${choice.label} ${choice.narration ?? ''}`)
    .join(' ');

  if (momentum) {
    const hasPortalTransition = PORTAL_TRANSITION_RE.test(fullText);
    const completedMajorBeat = momentum.justCompletedCombat || momentum.justCompletedDifficultChallenge;

    if (hasPortalTransition && !completedMajorBeat) {
      return 'Portal, teleport, or magical gateway transitions require this turn to complete combat or a difficult challenge.';
    }

    if (momentum.directive === 'victory_exit') {
      // Skip the victory-exit guard when an encounter is still actively running.
      // The momentum service can fire victory_exit based on turn count before all
      // enemies are actually defeated, so we should not penalize valid combat narration.
      if (input.encounterState?.status !== 'active') {
        const choicesInNewBeat = output.choices.filter(choice => CONCRETE_TRANSITION_RE.test(`${choice.label} ${choice.narration ?? ''}`)).length;
        const allChoicesStillCombat = output.choices.every(choice => COMBAT_LABEL_RE.test(`${choice.label} ${choice.narration ?? ''}`));
        const combatChoiceCount = output.choices.filter(choice => COMBAT_LABEL_RE.test(`${choice.label} ${choice.narration ?? ''}`)).length;
        if (!CONCRETE_TRANSITION_RE.test(fullText) || choicesInNewBeat < 2 || allChoicesStillCombat || combatChoiceCount > 1) {
          return 'Victory exit must move the party into a new beat, and at least two choices must act inside that new beat. No more than one choice may read as another attack.';
        }
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

  const repeatedResolvedThreat = repeatsResolvedThreat(input, `${output.narration} ${output.rollNarration ?? ''} ${nonItemChoiceText}`);
  if (repeatedResolvedThreat) {
    return `Output revives recently resolved threat: "${repeatedResolvedThreat}". Move to a different beat, consequence, clue, NPC, or location.`;
  }

  const hiddenPathLoop = HIDDEN_PATH_RE.test(fullText) && input.recentHistory.some(previous => HIDDEN_PATH_RE.test(previous));
  if (hiddenPathLoop) {
    return 'Hidden-path beat repeats recent story continuity. Pay off the discovered route or introduce a different concrete obstacle, clue, NPC, or location.';
  }

  const previousLabels = new Set((input.previousChoiceLabels ?? []).map(normalizedText));
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

  return null;
}

function normalizeEncounterOutput(input: NarrationInput, output: ValidNarrationOutput): void {
  // Block encounter start when one is already active
  if (output.suggestedEncounterStart != null && input.encounterState?.status === 'active') {
    devLog.warn('[Guard] suggestedEncounterStart blocked - encounter already active', { encounterName: input.encounterState.name });
    output.suggestedEncounterStart = null;
  }

  // Block re-spawning enemies that were all defeated in recent encounters
  if (output.suggestedEncounterStart != null && (input.resolvedEncounterEnemyNames?.length ?? 0) > 0) {
    const resolvedNames = new Set((input.resolvedEncounterEnemyNames ?? []).map(n => normalizedText(n)));
    const allDefeated = output.suggestedEncounterStart.enemies.every(e => resolvedNames.has(normalizedText(e.name)));
    if (allDefeated) {
      devLog.warn('[Guard] suggestedEncounterStart blocked - all proposed enemies already resolved', { enemies: output.suggestedEncounterStart.enemies.map(e => e.name) });
      output.suggestedEncounterStart = null;
    }
  }

  const update = output.suggestedEncounterUpdate;
  if (update == null) {
    return;
  }

  // Clear encounter update when no active encounter exists
  if (input.encounterState?.status !== 'active') {
    devLog.warn('[Guard] suggestedEncounterUpdate cleared - no active encounter');
    output.suggestedEncounterUpdate = null;
    return;
  }

  // Filter out invalid damage entries
  if (Array.isArray(update.enemyDamage)) {
    const before = update.enemyDamage.length;
    update.enemyDamage = update.enemyDamage.filter(d => {
      if (!d.enemyId && !d.enemyName) {
        return false;
      }
      if (typeof d.amount !== 'number' || d.amount <= 0) {
        return false;
      }
      const enemy = input.encounterState!.enemies.find(e =>
        (d.enemyId && e.id === d.enemyId) ||
        (d.enemyName && e.name.toLowerCase() === d.enemyName.toLowerCase())
      );
      return enemy?.status === 'active';
    });
    if (update.enemyDamage.length < before) {
      devLog.warn('[Guard] enemyDamage entries filtered', { before, after: update.enemyDamage.length });
    }
  }

  // Filter out status changes targeting already-resolved enemies
  if (Array.isArray(update.enemyStatus)) {
    const before = update.enemyStatus.length;
    update.enemyStatus = update.enemyStatus.filter(es => {
      const enemy = input.encounterState!.enemies.find(e =>
        (es.enemyId && e.id === es.enemyId) ||
        (es.enemyName && e.name.toLowerCase() === es.enemyName.toLowerCase())
      );
      return enemy?.status === 'active';
    });
    if (update.enemyStatus.length < before) {
      devLog.warn('[Guard] enemyStatus entries filtered', { before, after: update.enemyStatus.length });
    }
  }
}

function validateNarrationLeakage(output: ValidNarrationOutput): string | null {
  const allText = [
    output.narration,
    output.rollNarration,
    ...(output.choices ?? []).map(c => `${c.label} ${c.narration ?? ''}`),
  ].filter(Boolean).join(' ').toLowerCase();

  for (const fragment of INSTRUCTION_LEAK_FRAGMENTS) {
    if (allText.includes(fragment)) {
      return `The narration contains a system instruction fragment: "${fragment}". Do not copy sceneMomentum guidance or any backend directive into story prose. Write in-game narrative only.`;
    }
  }
  return null;
}

function repairChoiceActors(input: NarrationInput, output: ValidNarrationOutput): void {
  if (!input.nextCharacterName) {
    return;
  }
  for (const choice of output.choices) {
    if (choice.helperCharacterName === input.nextCharacterName) {
      devLog.warn('[Guard] helperCharacterName cleared - next actor cannot be own helper', { label: choice.label, nextCharacterName: input.nextCharacterName });
      choice.flavor = 'standard';
      delete choice.helperCharacterName;
    }
  }
}

function repairRepeatedItemChoices(input: NarrationInput, output: ValidNarrationOutput): void {
  const previousItemNames = new Set((input.previousChoiceItemNames ?? []).map(normalizedItemName));
  for (const choice of output.choices) {
    if (
      choice.flavor === 'item' &&
      choice.itemName &&
      previousItemNames.has(normalizedItemName(choice.itemName))
    ) {
      devLog.warn('[Guard] repeated item choice degraded to standard', { itemName: choice.itemName });
      choice.flavor = 'standard';
      delete choice.itemOwnerName;
      delete choice.itemName;
    }
  }
}

export function parseNarrationOutput(
  input: NarrationInput,
  raw: unknown,
  options: { enforceGameplayGuards?: boolean } = {},
): { success: true; data: NarrationOutput } | { success: false; error: string } {
  const enforceGameplayGuards = options.enforceGameplayGuards ?? true;
  const parsed = narrationOutputSchema.safeParse(raw);
  if (!parsed.success) {
    return { success: false, error: `schema: ${parsed.error.message}` };
  }

  if (enforceGameplayGuards) {
    const leakageError = validateNarrationLeakage(parsed.data);
    if (leakageError) {
      return { success: false, error: `leakage: ${leakageError}` };
    }
  }
  stripNarrationEmDashes(parsed.data);
  canonicalizeItemChoices(input, parsed.data);
  repairChoiceActors(input, parsed.data);
  repairRepeatedItemChoices(input, parsed.data);
  normalizeNarrationMetadata(input, parsed.data);
  normalizeEncounterOutput(input, parsed.data);
  if (enforceGameplayGuards) {
    const momentumError = validateMomentumOutput(input, parsed.data);
    if (momentumError) {
      return { success: false, error: `momentum: ${momentumError}` };
    }
  }

  // The schema uses .nullable() on optional fields for OpenAI Structured Outputs compatibility.
  // NarrationOutput uses undefined for those optionals; all callers use truthy checks so null is safe.
  return { success: true, data: parsed.data as unknown as NarrationOutput };
}
