import type { ActionAttempt, SessionState } from '../types.js';
import { computeBuffChanges, computeEncounterEnemyChanges, computeHpChanges, computeInventoryChanges } from './turnChangeService.js';
import { GameEngine } from './gameEngine.js';

// Public, immutable facts of a turn whose mechanics are already resolved. Narration
// and choices are generated FROM these facts in the resolved_first strategy, so
// presentation can describe consequences but never decide them. Internal contract:
// not an SSE payload. Contains no DM Prep or private chapter plan.
export interface ResolvedTurnFacts {
  baseRevision: number;
  actorName: string;
  action: string;
  roll: {
    stat: string;
    roll: number;
    target?: number;
    success: boolean;
    impact?: string;
  } | null;
  outcome: 'success' | 'failure' | 'no_roll';
  hpChanges: Array<{ name: string; change: number; newHp: number; maxHp: number; downed: boolean }>;
  inventoryChanges: Array<{ name: string; item: string; change: 'added' | 'removed' | 'updated' }>;
  effectChanges: Array<{ name: string; effect: string; kind: 'buff' | 'curse'; change: 'added' | 'removed' }>;
  encounter: {
    name: string;
    status: string;
    started: boolean;
    resolved: boolean;
    enemyChanges: Array<{ name: string; hpChange: number; newStatus?: string }>;
  } | null;
  nextActorName?: string;
  // Plain-language statements the narration must honor, in order.
  facts: string[];
}

const describeStat = (stat: string): string => (stat === 'none' ? 'no roll' : stat);

export const buildResolvedTurnFacts = (params: {
  previousSession: SessionState;
  resolvedState: SessionState;
  actionAttempt: ActionAttempt;
  actingCharId: string;
}): ResolvedTurnFacts => {
  const { previousSession, resolvedState, actionAttempt, actingCharId } = params;
  const actor = previousSession.party.find(c => c.id === actingCharId) ?? previousSession.party[0];
  const { actionResult } = actionAttempt;
  const rolled = actionResult.statUsed !== 'none';
  const hpChanges = computeHpChanges(previousSession.party, resolvedState.party).map(change => ({
    name: change.characterName,
    change: change.change,
    newHp: change.newHp,
    maxHp: change.maxHp,
    downed: change.newHp <= 0,
  }));
  const inventoryChanges = computeInventoryChanges(previousSession.party, resolvedState.party).map(change => ({
    name: change.characterName,
    item: change.itemName,
    change: change.type,
  }));
  const effectChanges = computeBuffChanges(previousSession.party, resolvedState.party).map(change => ({
    name: change.characterName,
    effect: change.buffName,
    kind: change.kind,
    change: change.type,
  }));

  const before = previousSession.encounterState;
  const after = resolvedState.encounterState;
  const started = after?.status === 'active' && before?.id !== after.id;
  const resolved = before?.status === 'active' && !!after && after.id === before.id && after.status !== 'active';
  const encounterEnemyChanges = computeEncounterEnemyChanges(before, after).map(change => ({
    name: change.enemyName,
    hpChange: change.hpChange,
    ...(change.newStatus && { newStatus: change.newStatus }),
  }));
  const encounter = after && (after.status === 'active' || resolved)
    ? { name: after.name, status: after.status, started, resolved, enemyChanges: encounterEnemyChanges }
    : null;

  const nextActorId = GameEngine.getNextActiveCharacter(resolvedState.party, actingCharId);
  const nextActorName = resolvedState.party.find(c => c.id === nextActorId)?.name;

  const facts: string[] = [
    rolled
      ? `${actor?.name ?? 'The hero'} attempted "${actionAttempt.actionAttempt}" with ${describeStat(actionResult.statUsed)} and ${actionResult.success ? 'SUCCEEDED' : 'FAILED'} (rolled ${actionResult.roll}${actionResult.difficultyTarget ? ` vs ${actionResult.difficultyTarget}` : ''}${actionResult.impact && actionResult.impact !== 'normal' ? `, ${actionResult.impact} impact` : ''}).`
      : `${actor?.name ?? 'The hero'} did "${actionAttempt.actionAttempt}" (no roll${actionResult.success ? '' : ', it did not work'}).`,
    ...hpChanges.map(change => change.change < 0
      ? `${change.name} lost ${-change.change} HP (now ${change.newHp}/${change.maxHp})${change.downed ? ' and is DOWNED' : ''}.`
      : `${change.name} regained ${change.change} HP (now ${change.newHp}/${change.maxHp}).`),
    ...inventoryChanges.map(change => change.change === 'added'
      ? `${change.name} gained the item "${change.item}".`
      : change.change === 'removed'
        ? `${change.name} no longer has "${change.item}".`
        : `${change.name}'s "${change.item}" changed.`),
    ...effectChanges.map(change => `${change.name} ${change.change === 'added' ? 'gained' : 'lost'} the ${change.kind} "${change.effect}".`),
    ...(encounter?.started ? [`A fight began: ${encounter.name}.`] : []),
    ...encounterEnemyChanges.map(change => change.newStatus && change.newStatus !== 'active'
      ? `${change.name} is ${change.newStatus}.`
      : `${change.name} took ${-change.hpChange} damage.`),
    ...(encounter?.resolved ? [`The fight "${encounter.name}" is over (${encounter.status}).`] : []),
    'Nothing else changed mechanically: no other items, healing, damage, defeats or new fights happened this turn.',
  ];

  return {
    baseRevision: previousSession.revision ?? 0,
    actorName: actor?.name ?? 'The hero',
    action: actionAttempt.actionAttempt,
    roll: rolled
      ? {
        stat: actionResult.statUsed,
        roll: actionResult.roll,
        ...(actionResult.difficultyTarget !== undefined && { target: actionResult.difficultyTarget }),
        success: actionResult.success,
        ...(actionResult.impact && { impact: actionResult.impact }),
      }
      : null,
    outcome: rolled ? (actionResult.success ? 'success' : 'failure') : 'no_roll',
    hpChanges,
    inventoryChanges,
    effectChanges,
    encounter,
    ...(nextActorName && { nextActorName }),
    facts,
  };
};
