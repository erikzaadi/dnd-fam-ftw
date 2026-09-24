import { devLog } from '../lib/devLog.js';
import type { SessionState, TurnResult } from '../types.js';
import { computeInventoryChanges } from './turnChangeService.js';

// Post-generation repairs that keep narration and choices consistent with the
// committed encounter state. Plan 4 classifies these as compensation for
// independent generation; they stay until a resolved-facts-first flow replaces them.

const encounterResolutionVerb = (status: string | undefined): string => {
  if (status === 'fled') {
    return 'breaks and flees';
  }
  if (status === 'surrendered') {
    return 'drops its guard and surrenders';
  }
  return 'collapses, defeated';
};

type PostEncounterLoot = {
  characterName: string;
  itemName: string;
};



const sentenceCase = (text: string): string => {
  const trimmed = text.trim();
  if (!trimmed) {
    return trimmed;
  }
  return `${trimmed.charAt(0).toLowerCase()}${trimmed.slice(1)}`;
};

const extractNextPromisedBeat = (storySummary: string | undefined): string | null => {
  if (!storySummary) {
    return null;
  }
  const match = /NEXT PROMISED BEAT:\s*([^\n]+)/i.exec(storySummary);
  const beat = match?.[1]?.trim().replace(/[.?!]+$/g, '');
  return beat || null;
};

const buildPostEncounterFollowThrough = (session: SessionState): string => {
  const nextBeat = extractNextPromisedBeat(session.storySummary);
  if (nextBeat) {
    return ` Now the party can ${sentenceCase(nextBeat)}.`;
  }
  return ' A clue, route, or decision waits beyond the battlefield.';
};

const getPostEncounterLoot = (previousSession: SessionState, newState: SessionState): PostEncounterLoot[] =>
  computeInventoryChanges(previousSession.party, newState.party)
    .filter(change => change.type === 'added')
    .map(change => ({ characterName: change.characterName, itemName: change.itemName }));

const buildLootNarration = (addedLoot: PostEncounterLoot[]): string => {
  if (addedLoot.length === 0) {
    return '';
  }
  const claims = addedLoot.map(change => `${change.characterName} claims ${change.itemName}`);
  const hums = addedLoot.length === 1
    ? ` ${addedLoot[0].itemName} still hums with usable magic.`
    : ' The new spoils still hum with usable magic.';
  return ` ${claims.join(', ')} from the aftermath.${hums}`;
};

export const alignTurnWithResolvedEncounter = (
  previousSession: SessionState,
  newState: SessionState,
  turnResult: TurnResult,
): void => {
  if (previousSession.encounterState?.status !== 'active' || newState.encounterState?.status === 'active') {
    return;
  }
  if (!newState.encounterState || previousSession.encounterState.id !== newState.encounterState.id) {
    return;
  }

  const resolvedEnemies = previousSession.encounterState.enemies.flatMap(beforeEnemy => {
    const afterEnemy = newState.encounterState?.enemies.find(e => e.id === beforeEnemy.id);
    if (beforeEnemy.status === 'active' && afterEnemy && afterEnemy.status !== 'active') {
      return [{ beforeEnemy, afterEnemy }];
    }
    return [];
  });
  if (resolvedEnemies.length === 0) {
    return;
  }

  const enemyNames = resolvedEnemies.map(e => e.afterEnemy.name || e.beforeEnemy.name).join(', ');
  const status = newState.encounterState.status;
  const resolution = encounterResolutionVerb(status);
  const addedLoot = getPostEncounterLoot(previousSession, newState);
  const lootNarration = buildLootNarration(addedLoot);
  const followThrough = buildPostEncounterFollowThrough(previousSession);
  turnResult.narration = `${enemyNames} ${resolution}.${lootNarration} The immediate fight is over.${followThrough}`;
  turnResult.currentTensionLevel = status === 'defeated' ? 'medium' : turnResult.currentTensionLevel;
  // AI choices for this turn already point forward - let stripChoicesTargetingDefeatedEnemies
  // clean up any stale enemy references rather than replacing with generic fallbacks.
  newState.lastChoices = turnResult.choices;
};

export const stripChoicesTargetingDefeatedEnemies = (
  newState: SessionState,
  turnResult: TurnResult,
): boolean => {
  // Defeated terms come from the live encounter (updated statuses cover both active
  // and just-resolved fights) plus the most recently archived encounter, so the turn
  // right after resolution moves the encounter to pastEncounters is still covered.
  const lastArchived = newState.pastEncounters?.[newState.pastEncounters.length - 1];
  const defeatedTerms = new Set([
    ...(newState.encounterState?.enemies ?? [])
      .filter(e => e.status !== 'active')
      .flatMap(e => [e.name, ...(e.aliases ?? [])].map(t => t.toLowerCase())),
    ...(!newState.encounterState && lastArchived
      ? lastArchived.enemies.flatMap(e => [e.name, ...(e.aliases ?? [])].map(t => t.toLowerCase()))
      : []),
  ]);
  if (defeatedTerms.size === 0) {
    return false;
  }
  const activeEnemies = (newState.encounterState?.enemies ?? []).filter(e => e.status === 'active');
  let changed = false;
  let replacedCount = 0;
  const fixedChoices = turnResult.choices.map(choice => {
    const lower = `${choice.label} ${choice.narration ?? ''}`.toLowerCase();
    if (![...defeatedTerms].some(term => lower.includes(term))) {
      return choice;
    }
    changed = true;
    const target = activeEnemies[0];
    // Vary replacements so multiple stripped choices don't render as identical buttons
    const variants = target
      ? [
        { label: `Press the attack on the ${target.name}`, narration: `Keep the pressure on the ${target.name} while the moment allows.` },
        { label: `Find an opening against the ${target.name}`, narration: `Watch the ${target.name} for a weakness to exploit.` },
        { label: `Throw the ${target.name} off balance`, narration: `Disrupt the ${target.name} before they can regroup.` },
      ]
      : [
        { label: 'Hold position and stay ready', narration: 'Brace and stay alert for what comes next.' },
        { label: 'Scan the area for the next threat', narration: 'Sweep the surroundings before moving on.' },
        { label: 'Regroup with the party', narration: 'Pull together and plan the next move.' },
      ];
    const replacement = variants[replacedCount % variants.length];
    replacedCount++;
    devLog.warn(`[Guard] choice targets defeated enemy - replacing. original="${choice.label}" new="${replacement.label}"`);
    return {
      label: replacement.label,
      difficulty: choice.difficulty,
      stat: choice.stat,
      difficultyValue: choice.difficultyValue,
      narration: replacement.narration,
      flavor: 'standard' as const,
    };
  });
  if (changed) {
    turnResult.choices = fixedChoices;
    newState.lastChoices = fixedChoices;
  }
  return changed;
};
