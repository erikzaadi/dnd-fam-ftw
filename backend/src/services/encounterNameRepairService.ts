import { createChatClientForTier } from '../providers/ai/AiProviderFactory.js';
import { devLog } from '../lib/devLog.js';
import type { EncounterState, SessionState } from '../types.js';
import { buildEnemyAliases, isLowQualityEncounterName, normalizeEnemyName, resolveEncounterSeed } from './encounterService.js';

const NAME_REPAIR_TIMEOUT_MS = 2500;
const MAX_CONTEXT_CHARS = 900;

const titleCaseWords = (value: string): string =>
  value
    .split(/\s+/)
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');

const cleanGeneratedName = (raw: string): string | null => {
  const firstLine = raw
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .split('\n')
    .map(line => line.trim())
    .find(Boolean);
  if (!firstLine) {
    return null;
  }

  const cleaned = firstLine
    .replace(/^name\s*:\s*/i, '')
    .replace(/^["'`]+|["'`.,:;!?\s]+$/g, '')
    .replace(/[^a-zA-Z0-9'\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(/\s+/)
    .slice(0, 4)
    .join(' ');

  if (!cleaned || isLowQualityEncounterName(cleaned)) {
    return null;
  }
  return titleCaseWords(cleaned);
};

const salvageName = (name: string): string | null => {
  let words = normalizeEnemyName(name).split(' ').filter(Boolean);
  while (words.length > 1 && isLowQualityEncounterName(words.join(' '))) {
    words = words.slice(0, -1);
  }
  const candidate = titleCaseWords(words.join(' '));
  return candidate && !isLowQualityEncounterName(candidate) ? candidate : null;
};

const contextualFallbackName = (context: string): string => {
  if (/\b(cartel|tariff|ledger|invoice|market|merchant|audit|vault)\b/i.test(context)) {
    return 'Ledger Sentinel';
  }
  if (/\b(rune|pillar|ward|glyph|sigil)\b/i.test(context)) {
    return 'Rune Sentinel';
  }
  if (/\b(wild magic|fissure|arcane|spell|reality)\b/i.test(context)) {
    return 'Arcane Riftspawn';
  }
  if (/\b(shadow|dark|shade)\b/i.test(context)) {
    return 'Shadow Ambusher';
  }
  return 'Hidden Ambusher';
};

const buildRepairContext = (
  encounter: EncounterState,
  input: { scene?: string; narration?: string | null; actionAttempt?: string | null },
): string => [
  `Scene: ${input.scene ?? 'unknown'}`,
  `Action: ${input.actionAttempt ?? 'unknown'}`,
  `Narration: ${input.narration ?? 'unknown'}`,
  `Current bad name: ${encounter.name}`,
  `Objective: ${encounter.objective ?? 'unknown'}`,
  `Enemy traits: ${encounter.enemies.flatMap(enemy => enemy.traits ?? []).join(', ') || 'unknown'}`,
  `Weaknesses: ${encounter.enemies.flatMap(enemy => enemy.weaknesses?.map(w => w.label) ?? []).join(', ') || 'unknown'}`,
].join('\n').slice(0, MAX_CONTEXT_CHARS);

const repairedNameFromAi = async (
  encounter: EncounterState,
  input: { scene?: string; narration?: string | null; actionAttempt?: string | null },
): Promise<string | null> => {
  const { client, model } = createChatClientForTier('preview');
  const started = Date.now();
  devLog.log(`[EncounterNameRepair] start model=${model} encounter=${encounter.id} badName="${encounter.name}"`);
  try {
    const response = await client.chat.completions.create({
      model,
      messages: [
        {
          role: 'system',
          content: [
            'Name one family-friendly fantasy combat foe.',
            'Reply with the name only.',
            'Use 2-4 words.',
            'Do not use generic labels like foe, enemy, threat, powerful, fierce, radiant, ambusher, or incomplete prose fragments.',
          ].join(' '),
        },
        { role: 'user', content: buildRepairContext(encounter, input) },
      ],
      max_tokens: 24,
    }, { signal: AbortSignal.timeout(NAME_REPAIR_TIMEOUT_MS) });
    const raw = response.choices[0]?.message?.content ?? '';
    const repaired = cleanGeneratedName(raw);
    devLog.log(`[EncounterNameRepair] done model=${model} encounter=${encounter.id} durationMs=${Date.now() - started} fallback=${repaired ? 'false' : 'true'}`);
    return repaired;
  } catch (err) {
    devLog.warn(`[EncounterNameRepair] failed encounter=${encounter.id} durationMs=${Date.now() - started}`, err);
    return null;
  }
};

const replaceNameInText = (text: string | undefined, oldName: string, newName: string): string | undefined => {
  if (!text) {
    return text;
  }
  const escaped = oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), newName);
};

const renameEncounter = (encounter: EncounterState, oldName: string, newName: string): void => {
  encounter.name = encounter.name === oldName || isLowQualityEncounterName(encounter.name) ? newName : encounter.name;
  encounter.objective = replaceNameInText(encounter.objective, oldName, newName);
  encounter.lastResolvedEnemyName = encounter.lastResolvedEnemyName
    ? replaceNameInText(encounter.lastResolvedEnemyName, oldName, newName)
    : encounter.lastResolvedEnemyName;
  for (const enemy of encounter.enemies) {
    if (enemy.name === oldName || isLowQualityEncounterName(enemy.name)) {
      enemy.name = newName;
      enemy.aliases = buildEnemyAliases(newName);
    }
  }
};

export const repairEncounterNameIfNeeded = async (
  previousSession: SessionState,
  newState: SessionState,
  input: { narration?: string | null; actionAttempt?: string | null },
): Promise<void> => {
  const encounter = newState.encounterState;
  if (!encounter || resolveEncounterSeed(encounter.name, newState.dmPrepEncounters ?? [])) {
    return;
  }

  const badNames = [
    encounter.name,
    ...encounter.enemies.map(enemy => enemy.name),
  ].filter(isLowQualityEncounterName);
  if (badNames.length === 0) {
    return;
  }

  const oldName = badNames[0];
  const context = {
    scene: newState.scene,
    narration: input.narration,
    actionAttempt: input.actionAttempt,
  };
  const repairedName = await repairedNameFromAi(encounter, context)
    ?? salvageName(oldName)
    ?? contextualFallbackName(buildRepairContext(encounter, context));
  renameEncounter(encounter, oldName, repairedName);

  const matchingPastEncounter = newState.pastEncounters?.find(past => past.id === encounter.id);
  if (matchingPastEncounter) {
    renameEncounter(matchingPastEncounter, oldName, repairedName);
  }

  devLog.log(`[EncounterNameRepair] renamed encounter=${encounter.id} old="${oldName}" new="${repairedName}" previousTurn=${previousSession.turn}`);
};
