import type { EncounterState, TurnResult } from '../types';

export const buildEncounterLookup = (
  activeEncounter?: EncounterState | null,
  pastEncounters?: EncounterState[] | null,
): Map<string, EncounterState> => {
  const lookup = new Map<string, EncounterState>();
  for (const encounter of pastEncounters ?? []) {
    lookup.set(encounter.id, encounter);
  }
  if (activeEncounter) {
    lookup.set(activeEncounter.id, activeEncounter);
  }
  return lookup;
};

export const getTurnEncounter = (
  turn: TurnResult | null | undefined,
  lookup: Map<string, EncounterState>,
): EncounterState | null => {
  if (!turn?.encounterId) {
    return null;
  }
  return lookup.get(turn.encounterId) ?? null;
};

export const countEncounterTurns = (history: TurnResult[], encounterId: string): number =>
  history.filter(turn => turn.encounterId === encounterId).length;
