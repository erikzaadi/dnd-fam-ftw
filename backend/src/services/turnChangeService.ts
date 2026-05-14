import type { BuffChange, Character, EncounterEnemyChange, EncounterState, HpChange, InventoryChange } from '../types.js';

export const computeHpChanges = (before: Character[], after: Character[]): HpChange[] => {
  const changes: HpChange[] = [];
  for (const beforeChar of before) {
    const afterChar = after.find(c => c.id === beforeChar.id);
    if (afterChar && afterChar.hp !== beforeChar.hp) {
      changes.push({
        characterId: beforeChar.id,
        characterName: beforeChar.name,
        change: afterChar.hp - beforeChar.hp,
        newHp: afterChar.hp,
        maxHp: beforeChar.max_hp,
      });
    }
  }
  return changes;
};

export const computeInventoryChanges = (before: Character[], after: Character[]): InventoryChange[] => {
  const changes: InventoryChange[] = [];
  for (const beforeChar of before) {
    const afterChar = after.find(c => c.id === beforeChar.id);
    if (!afterChar) {
      continue;
    }
    const beforeIds = new Set(beforeChar.inventory.map(i => i.id));
    const afterIds = new Set(afterChar.inventory.map(i => i.id));
    const beforeById = new Map(beforeChar.inventory.map(i => [i.id, i]));
    for (const item of afterChar.inventory) {
      if (!beforeIds.has(item.id)) {
        changes.push({ characterName: afterChar.name, itemName: item.name, type: 'added' });
        continue;
      }
      const beforeItem = beforeById.get(item.id);
      if (beforeItem && JSON.stringify(beforeItem) !== JSON.stringify(item)) {
        changes.push({ characterName: afterChar.name, itemName: item.name, type: 'updated' });
      }
    }
    for (const item of beforeChar.inventory) {
      if (!afterIds.has(item.id)) {
        changes.push({ characterName: beforeChar.name, itemName: item.name, type: 'removed' });
      }
    }
  }
  return changes;
};

export const computeEncounterEnemyChanges = (
  before: EncounterState | null | undefined,
  after: EncounterState | null | undefined,
): EncounterEnemyChange[] => {
  if (!before || !after || before.id !== after.id) {
    return [];
  }
  const changes: EncounterEnemyChange[] = [];
  for (const beforeEnemy of before.enemies) {
    const afterEnemy = after.enemies.find(e => e.id === beforeEnemy.id);
    if (!afterEnemy) {
      continue;
    }
    const hpChange = afterEnemy.hp - beforeEnemy.hp;
    const statusChanged = afterEnemy.status !== beforeEnemy.status;
    if (hpChange !== 0 || statusChanged) {
      changes.push({
        enemyId: beforeEnemy.id,
        enemyName: beforeEnemy.name,
        hpChange,
        ...(statusChanged && { newStatus: afterEnemy.status }),
      });
    }
  }
  return changes;
};

export const computeBuffChanges = (before: Character[], after: Character[]): BuffChange[] => {
  const changes: BuffChange[] = [];
  for (const beforeChar of before) {
    const afterChar = after.find(c => c.id === beforeChar.id);
    if (!afterChar) {
      continue;
    }
    const beforeIds = new Set((beforeChar.buffs ?? []).map(b => b.id));
    const afterIds = new Set((afterChar.buffs ?? []).map(b => b.id));
    for (const buff of afterChar.buffs ?? []) {
      if (!beforeIds.has(buff.id)) {
        changes.push({ characterName: afterChar.name, buffName: buff.name, kind: buff.kind ?? 'buff', type: 'added' });
      }
    }
    for (const buff of beforeChar.buffs ?? []) {
      if (!afterIds.has(buff.id)) {
        changes.push({ characterName: beforeChar.name, buffName: buff.name, kind: buff.kind ?? 'buff', type: 'removed' });
      }
    }
  }
  return changes;
};
