import type { TurnStrategy } from '../config/env.js';
import type { ActionAttempt, AgentDiagnostic, SessionState, TurnResult } from '../types.js';
import {
  dropRedundantBuffAdds,
  dropUnearnedBuffAdds,
  ensureSuccessfulEnchantmentSuggestion,
  ensureSuccessfulHealingSuggestion,
  ensureSuccessfulSupportSuggestion,
  suppressFailedSupportDamage,
} from './freeActionPolicyService.js';

// One structured record per committed turn, comparable across strategies (plan 4).
// Contains ids, stage timings, agent outcomes and repair names only: no narration,
// player text or DM Prep, so it is safe for routine production logs.
export type TurnDiagnosticsRecord = {
  strategy: TurnStrategy;
  stages: Array<{ stage: string; durationMs: number }>;
  // Names of repairs that changed the turn (see family-first-04-repair-inventory.md).
  repairs: string[];
  // Milliseconds from turn start to the first streamed narration chunk, when streamed.
  firstNarrationMs?: number;
};

export const createTurnDiagnostics = (strategy: TurnStrategy) => {
  const record: TurnDiagnosticsRecord = { strategy, stages: [], repairs: [] };
  return {
    record,
    stage(stage: string, start: number): number {
      const now = Date.now();
      record.stages.push({ stage, durationMs: now - start });
      return now;
    },
    repair(name: string): void {
      if (!record.repairs.includes(name)) {
        record.repairs.push(name);
      }
    },
  };
};

export type TurnDiagnostics = ReturnType<typeof createTurnDiagnostics>;

// Mechanical policy repairs shared by both strategies. Each returns the same object
// when it made no change, so identity marks which repairs fired.
export const applyTurnPolicies = (
  session: SessionState,
  actionAttempt: ActionAttempt,
  turnResult: TurnResult,
  actionIntent: string | undefined,
  targetCharName: string | undefined,
  diagnostics: TurnDiagnostics,
): TurnResult => {
  const steps: Array<[string, (t: TurnResult) => TurnResult]> = [
    ['ensure_healing', t => ensureSuccessfulHealingSuggestion(session, actionAttempt, t)],
    ['ensure_enchantment', t => ensureSuccessfulEnchantmentSuggestion(session, actionAttempt, t)],
    ['ensure_support', t => ensureSuccessfulSupportSuggestion(session, actionAttempt, t, actionIntent, targetCharName)],
    ['drop_redundant_buffs', t => dropRedundantBuffAdds(session, t, actionIntent)],
    ['drop_unearned_buffs', t => dropUnearnedBuffAdds(actionAttempt, t, actionIntent)],
    ['suppress_failed_support_damage', t => suppressFailedSupportDamage(actionAttempt, t, actionIntent)],
  ];
  let current = turnResult;
  for (const [name, apply] of steps) {
    const next = apply(current);
    if (next !== current) {
      diagnostics.repair(name);
    }
    current = next;
  }
  return current;
};

export const logTurnDiagnostics = (params: {
  sessionId: string;
  operationId?: string;
  turnId?: number;
  baseRevision: number;
  revision: number;
  totalMs: number;
  record: TurnDiagnosticsRecord;
  agents?: AgentDiagnostic[];
  narrationFailed?: boolean;
  choicesFailed?: boolean;
}): void => {
  const { record, agents, ...rest } = params;
  console.log(`[TurnDiag] ${JSON.stringify({
    ...rest,
    strategy: record.strategy,
    stages: record.stages,
    repairs: record.repairs,
    ...(record.firstNarrationMs !== undefined && { firstNarrationMs: record.firstNarrationMs }),
    agents: (agents ?? []).map(a => ({ agent: a.agent, status: a.status, durationMs: a.durationMs, ...(a.errorKind && { errorKind: a.errorKind }) })),
  })}`);
};
