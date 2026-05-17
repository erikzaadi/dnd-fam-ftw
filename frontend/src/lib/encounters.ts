import type { EncounterState, Session, TurnResult } from '../types';

const patchEncounterInLists = (
  session: Session,
  encounterId: string,
  patchFn: (enc: EncounterState) => EncounterState,
): Session => {
  const patchActive = session.encounterState?.id === encounterId
    ? patchFn(session.encounterState)
    : session.encounterState;
  const patchPast = (session.pastEncounters ?? []).map(enc =>
    enc.id === encounterId ? patchFn(enc) : enc,
  );
  return { ...session, encounterState: patchActive, pastEncounters: patchPast };
};

export const patchEncounterEnemyAvatar = (
  session: Session,
  encounterId: string,
  enemyId: string,
  imageUrl: string,
): Session =>
  patchEncounterInLists(session, encounterId, enc => ({
    ...enc,
    enemies: enc.enemies.map(e => e.id === enemyId ? { ...e, avatarUrl: imageUrl } : e),
  }));

export const patchEncounterAreaImage = (
  session: Session,
  encounterId: string,
  areaId: string,
  imageUrl: string,
): Session =>
  patchEncounterInLists(session, encounterId, enc => ({
    ...enc,
    areas: enc.areas.map(a => a.id === areaId ? { ...a, imageUrl } : a),
  }));

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
