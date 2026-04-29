import type { Character, HpChange, InventoryChange } from '../types.js';

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
    for (const item of afterChar.inventory) {
      if (!beforeIds.has(item.id)) {
        changes.push({ characterName: afterChar.name, itemName: item.name, type: 'added' });
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
