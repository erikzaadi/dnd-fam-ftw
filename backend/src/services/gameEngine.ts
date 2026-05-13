import { Character, SessionState, ActionAttempt, InventoryItem, Choice, type CharacterBuff, type Stat, type Difficulty } from '../types.js';
import { createId } from '../lib/ids.js';
import { handleEncounterStart, applyEncounterUpdate } from './encounterService.js';
import type { EncounterStartProposal, EncounterUpdateProposal } from '../providers/ai/narration/narrationSchemas.js';

export class GameEngine {
  private static DIFFICULTIES = {
    easy: 8,
    normal: 12,
    hard: 16
  };

  private static DAMAGE_BY_DIFFICULTY = {
    easy: 1,
    normal: 2,
    hard: 3,
    none: 0
  };

  private static normalize(s: string): string {
    return s.toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  private static editDistance(a: string, b: string): number {
    const m = a.length, n = b.length;
    const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
      Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
    );
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        dp[i][j] = a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
    return dp[m][n];
  }

  private static capItemStatBonuses(statBonuses: InventoryItem['statBonuses']): InventoryItem['statBonuses'] {
    if (!statBonuses) {
      return undefined;
    }
    const capped: InventoryItem['statBonuses'] = {};
    for (const stat of ['might', 'magic', 'mischief'] as const) {
      const value = statBonuses[stat];
      if (typeof value === 'number' && value > 0) {
        capped[stat] = Math.min(3, Math.max(0, Math.round(value)));
      }
    }
    return Object.keys(capped).length > 0 ? capped : undefined;
  }

  private static capEffectStatBonuses(statBonuses: CharacterBuff['statBonuses']): CharacterBuff['statBonuses'] {
    if (!statBonuses) {
      return undefined;
    }
    const capped: CharacterBuff['statBonuses'] = {};
    for (const stat of ['might', 'magic', 'mischief'] as const) {
      const value = statBonuses[stat];
      if (typeof value === 'number' && value !== 0) {
        capped[stat] = Math.min(2, Math.max(-2, Math.round(value)));
      }
    }
    return Object.keys(capped).length > 0 ? capped : undefined;
  }

  private static buildBuffBonus(character: Character, statName: Stat): { bonus: number; label?: string } {
    const buffEntries = (character.buffs ?? [])
      .map(buff => ({ buff, bonus: buff.statBonuses?.[statName] ?? 0 }))
      .filter(entry => entry.bonus !== 0);
    const rawBonus = buffEntries.reduce((sum, entry) => sum + entry.bonus, 0);
    const bonus = Math.min(3, Math.max(-3, rawBonus));
    if (bonus === 0) {
      return { bonus: 0 };
    }
    const positiveCount = buffEntries.filter(entry => entry.bonus > 0).length;
    const negativeCount = buffEntries.filter(entry => entry.bonus < 0).length;
    const fallbackLabel = positiveCount > 0 && negativeCount > 0
      ? 'effects'
      : positiveCount > 0
        ? 'buffs'
        : 'curses';
    return {
      bonus,
      label: buffEntries.length === 1 ? buffEntries[0].buff.name : fallbackLabel,
    };
  }

  private static cleanBuff(rawBuff: Omit<CharacterBuff, 'id'>): Omit<CharacterBuff, 'id'> | null {
    const name = typeof rawBuff.name === 'string' ? rawBuff.name.trim() : '';
    const description = typeof rawBuff.description === 'string' ? rawBuff.description.trim() : '';
    if (!name || !description) {
      return null;
    }

    const statBonuses = this.capEffectStatBonuses(rawBuff.statBonuses);
    const hasTurns = typeof rawBuff.remainingTurns === 'number';
    const hasUses = typeof rawBuff.remainingUses === 'number';
    const remainingTurns = hasTurns
      ? Math.min(3, Math.max(1, Math.round(rawBuff.remainingTurns!)))
      : undefined;
    const remainingUses = hasUses
      ? Math.min(3, Math.max(1, Math.round(rawBuff.remainingUses!)))
      : undefined;
    const fallbackDuration = !remainingTurns && !remainingUses ? { remainingTurns: 2 } : {};

    return {
      name,
      description,
      ...(rawBuff.kind === 'curse' || rawBuff.kind === 'buff' ? { kind: rawBuff.kind } : {}),
      ...(statBonuses && { statBonuses }),
      ...(remainingTurns && { remainingTurns }),
      ...(remainingUses && { remainingUses }),
      ...fallbackDuration,
      ...(typeof rawBuff.sourceCharacterName === 'string' && rawBuff.sourceCharacterName.trim() && {
        sourceCharacterName: rawBuff.sourceCharacterName.trim(),
      }),
    };
  }

  private static refreshOrAddBuff(character: Character, buff: Omit<CharacterBuff, 'id'>): void {
    character.buffs = character.buffs ?? [];
    const existing = character.buffs.find(active => this.normalize(active.name) === this.normalize(buff.name));
    if (existing) {
      existing.description = buff.description;
      existing.kind = buff.kind;
      existing.statBonuses = buff.statBonuses;
      existing.sourceCharacterName = buff.sourceCharacterName;
      existing.remainingTurns = buff.remainingTurns;
      existing.remainingUses = buff.remainingUses;
      return;
    }
    character.buffs.push({ id: createId(), ...buff });
  }

  private static decrementUsedBuffs(character: Character, statName: Stat | 'none'): void {
    if (statName === 'none' || !character.buffs?.length) {
      return;
    }
    for (const buff of character.buffs) {
      if ((buff.statBonuses?.[statName] ?? 0) !== 0 && typeof buff.remainingUses === 'number') {
        buff.remainingUses = Math.max(0, buff.remainingUses - 1);
      }
    }
    character.buffs = character.buffs.filter(buff => (buff.remainingUses ?? 1) > 0);
  }

  private static decrementTurnBuffs(character: Character): void {
    if (!character.buffs?.length) {
      return;
    }
    for (const buff of character.buffs) {
      if (typeof buff.remainingTurns === 'number') {
        buff.remainingTurns = Math.max(0, buff.remainingTurns - 1);
      }
    }
    character.buffs = character.buffs.filter(buff => (buff.remainingTurns ?? 1) > 0);
  }

  private static cleanItemTags(tags: unknown): string[] | undefined {
    if (!Array.isArray(tags)) {
      return undefined;
    }
    const cleaned = tags
      .filter((tag): tag is string => typeof tag === 'string')
      .map(tag => tag.trim())
      .filter(Boolean)
      .slice(0, 5);
    return cleaned.length > 0 ? cleaned : undefined;
  }

  // Fuzzy character lookup: exact → normalized contains → class match → closest edit distance
  public static findCharacter(party: Character[], targetName: string): Character | undefined {
    if (!targetName) {
      return undefined;
    }
    const t = this.normalize(targetName);

    const exact = party.find(c => c.name.toLowerCase() === targetName.toLowerCase());
    if (exact) {
      return exact;
    }

    const normalized = party.find(c => {
      const n = this.normalize(c.name);
      return n === t || n.includes(t) || t.includes(n);
    });
    if (normalized) {
      return normalized;
    }

    const byClass = party.find(c => t.includes(this.normalize(c.class)));
    if (byClass) {
      return byClass;
    }

    // Closest edit distance within threshold of 3
    let best: Character | undefined;
    let bestDist = 4;
    for (const c of party) {
      const dist = this.editDistance(t, this.normalize(c.name));
      if (dist < bestDist) {
        bestDist = dist; best = c; 
      }
    }
    return best;
  }

  // Returns the id of the next active (non-downed) character after currentId.
  // Used to tell the AI who will act NEXT so choices are generated for the right character.
  public static getNextActiveCharacter(party: Character[], currentId: string): string {
    const activeIdx = party.findIndex(c => c.id === currentId);
    if (activeIdx === -1 || party.length === 0) {
      return currentId;
    }
    let nextIdx = (activeIdx + 1) % party.length;
    let attempts = 0;
    while (party[nextIdx].status === 'downed' && attempts < party.length) {
      nextIdx = (nextIdx + 1) % party.length;
      attempts++;
    }
    return party[nextIdx].status !== 'downed' ? party[nextIdx].id : currentId;
  }

  public static rollDice(stat: number): { roll: number; total: number } {
    const roll = Math.floor(Math.random() * 20) + 1;
    return { roll, total: roll + stat };
  }

  public static checkSuccess(total: number, difficultyLabel: Difficulty | number): boolean {
    const difficulty = typeof difficultyLabel === 'number'
      ? difficultyLabel
      : (this.DIFFICULTIES[difficultyLabel] || 12);
    return total >= difficulty;
  }

  public static isPartyWiped(state: SessionState): boolean {
    return state.party.length > 0 && state.party.every(c => c.status === 'downed');
  }

  public static getRescueLimit(difficulty: string): number {
    if (difficulty === 'zug-ma-geddon') {
      return 0;
    }
    if (difficulty === 'hard') {
      return 1;
    }
    if (difficulty === 'normal') {
      return 2;
    }
    // easy: endless
    return Infinity;
  }

  public static applySanctuaryRecovery(state: SessionState): SessionState {
    const newState: SessionState = JSON.parse(JSON.stringify(state));
    for (const char of newState.party) {
      if (char.status === 'downed') {
        char.status = 'active';
        char.hp = 1;
        char.buffs = [];
      }
    }
    if (newState.party.length > 0) {
      newState.activeCharacterId = newState.party[0].id;
    }
    newState.interventionState = { rescuesUsed: (state.interventionState?.rescuesUsed ?? 0) + 1 };
    return newState;
  }

  public static applyIntervention(state: SessionState): SessionState {
    const newState: SessionState = JSON.parse(JSON.stringify(state));
    for (const char of newState.party) {
      if (char.status === 'downed') {
        char.status = 'active';
        char.hp = 1;
        char.buffs = [];
      }
    }
    newState.interventionState = { rescuesUsed: (state.interventionState?.rescuesUsed ?? 0) + 1 };
    if (newState.party.length > 0) {
      newState.activeCharacterId = newState.party[0].id;
    }
    return newState;
  }

  public static applyItemUse(
    state: SessionState,
    actingCharId: string,
    itemId: string,
    targetCharId: string
  ): { newState: SessionState; actionAttempt: ActionAttempt; error?: string } {
    const newState: SessionState = JSON.parse(JSON.stringify(state));
    const actingChar = newState.party.find(c => c.id === actingCharId);
    if (!actingChar) {
      return { newState, actionAttempt: { actionAttempt: 'use item', actionResult: { success: false, roll: 0, statUsed: 'none' } }, error: 'Acting character not found' };
    }

    const itemIdx = actingChar.inventory.findIndex(i => i.id === itemId);
    if (itemIdx === -1) {
      return { newState, actionAttempt: { actionAttempt: 'use item', actionResult: { success: false, roll: 0, statUsed: 'none' } }, error: 'Item not found in inventory' };
    }

    const item = actingChar.inventory[itemIdx];
    const targetChar = newState.party.find(c => c.id === targetCharId) ?? actingChar;

    let description = `${actingChar.name} used ${item.name}`;
    if (targetChar.id !== actingChar.id) {
      description += ` on ${targetChar.name}`;
    }

    // Apply heal
    if (item.healValue && item.healValue > 0) {
      const wasDown = targetChar.status === 'downed';
      targetChar.hp = Math.min(targetChar.max_hp, targetChar.hp + item.healValue);
      if (targetChar.hp > 0 && targetChar.status === 'downed') {
        targetChar.status = 'active';
        targetChar.buffs = [];
      }
      description += wasDown
        ? `, reviving ${targetChar.name} to ${targetChar.hp} HP`
        : `, healing ${targetChar.name} for ${item.healValue} HP`;
    }

    // Remove consumable after successful use
    if (item.consumable) {
      actingChar.inventory.splice(itemIdx, 1);
    }

    return {
      newState,
      actionAttempt: {
        actionAttempt: description,
        actionResult: { success: true, roll: 0, statUsed: 'none' }
      }
    };
  }

  public static applyGiveItem(
    state: SessionState,
    actingCharId: string,
    itemId: string,
    targetCharId: string
  ): { newState: SessionState; actionAttempt: ActionAttempt; error?: string } {
    const newState: SessionState = JSON.parse(JSON.stringify(state));
    const actingChar = newState.party.find(c => c.id === actingCharId);
    const targetChar = newState.party.find(c => c.id === targetCharId);

    if (!actingChar || !targetChar) {
      return { newState, actionAttempt: { actionAttempt: 'give item', actionResult: { success: false, roll: 0, statUsed: 'none' } }, error: 'Character not found' };
    }

    const itemIdx = actingChar.inventory.findIndex(i => i.id === itemId);
    if (itemIdx === -1) {
      return { newState, actionAttempt: { actionAttempt: 'give item', actionResult: { success: false, roll: 0, statUsed: 'none' } }, error: 'Item not found in inventory' };
    }

    const item = actingChar.inventory[itemIdx];
    if (!item.transferable) {
      return { newState, actionAttempt: { actionAttempt: 'give item', actionResult: { success: false, roll: 0, statUsed: 'none' } }, error: 'Item is not transferable' };
    }

    actingChar.inventory.splice(itemIdx, 1);
    targetChar.inventory.push(item);

    return {
      newState,
      actionAttempt: {
        actionAttempt: `${actingChar.name} gave ${item.name} to ${targetChar.name}`,
        actionResult: { success: true, roll: 0, statUsed: 'none' }
      }
    };
  }

  public static resolveAction(
    character: Character,
    action: string,
    statName: Stat | 'none',
    difficulty: Difficulty = 'normal',
    difficultyValue?: number,
    helper?: { name: string; bonus: number },
    choiceItem?: { name: string; ownerName: string; bonus: number },
    characterEdge?: { label: string; bonus: number }
  ): ActionAttempt {
    if (statName === 'none') {
      return {
        actionAttempt: action,
        actionResult: {
          success: true,
          roll: 0,
          statUsed: 'none'
        }
      };
    }

    const statValue = character.stats[statName];
    const itemBonus = character.inventory.reduce((sum, item) => sum + (item.statBonuses?.[statName] ?? 0), 0);
    const helperBonus = helper?.bonus ?? 0;
    const choiceItemBonus = choiceItem?.bonus ?? 0;
    const characterBonus = characterEdge?.bonus ?? 0;
    const { bonus: buffBonus, label: buffBonusLabel } = this.buildBuffBonus(character, statName);
    const { roll, total } = this.rollDice(statValue);
    const target = difficultyValue ?? this.DIFFICULTIES[difficulty] ?? 12;
    const finalTotal = total + itemBonus + helperBonus + choiceItemBonus + characterBonus + buffBonus;
    const success = roll === 20 || (roll !== 1 && this.checkSuccess(finalTotal, target));
    const margin = success ? finalTotal - target : target - finalTotal;
    const impact = roll === 1 || roll === 20 || margin >= 12
      ? 'extreme'
      : margin >= 8
        ? 'strong'
        : 'normal';

    return {
      actionAttempt: action,
      actionResult: {
        success,
        roll,
        statUsed: statName,
        statBonus: statValue,
        impact,
        difficultyTarget: target,
        ...(itemBonus > 0 && { itemBonus }),
        ...(helperBonus > 0 && { helperBonus }),
        ...(helperBonus > 0 && helper?.name && { helperCharacterName: helper.name }),
        ...(choiceItemBonus > 0 && { choiceItemBonus }),
        ...(choiceItemBonus > 0 && choiceItem?.name && { choiceItemName: choiceItem.name }),
        ...(choiceItemBonus > 0 && choiceItem?.ownerName && { choiceItemOwnerName: choiceItem.ownerName }),
        ...(characterBonus > 0 && { characterBonus }),
        ...(characterBonus > 0 && characterEdge?.label && { characterBonusLabel: characterEdge.label }),
        ...(buffBonus !== 0 && { buffBonus }),
        ...(buffBonus !== 0 && buffBonusLabel && { buffBonusLabel }),
      }
    };
  }

  public static updateState(state: SessionState, actionAttempt: ActionAttempt, aiSuggestedChanges?: Record<string, unknown>): SessionState {
    const newState: SessionState = JSON.parse(JSON.stringify(state));
    newState.turn += 1;

    // 1. History
    newState.recentHistory.push(actionAttempt.actionAttempt);
    if (newState.recentHistory.length > 5) {
      newState.recentHistory.shift();
    }

    // 2. Resolve mechanics (HP, Inventory)
    if (newState.party.length > 0) {
      const activeIdx = newState.party.findIndex(c => c.id === state.activeCharacterId);
      const actingChar = activeIdx !== -1 ? newState.party[activeIdx] : newState.party[0];

      // HP Damage on failure - AI decides; fallback to difficulty-based if AI returned null
      // Skip damage entirely if the AI set healing for another character (support/heal action)
      const healTargets = Array.isArray(aiSuggestedChanges?.suggestedHeal)
        ? (aiSuggestedChanges.suggestedHeal as Array<{ characterName: string }>).map(h => this.normalize(h.characterName))
        : [];
      const isHealingOther = healTargets.length > 0 && !healTargets.includes(this.normalize(actingChar.name));

      if (!actionAttempt.actionResult.success && actionAttempt.actionResult.statUsed !== 'none' && !isHealingOther) {
        const aiDamage = typeof aiSuggestedChanges?.suggestedDamage === 'number'
          ? (aiSuggestedChanges.suggestedDamage as number)
          : null;

        let damage: number;
        if (aiDamage !== null) {
          damage = aiDamage;
        } else {
          const lastTurnChoices = state.lastChoices || [];
          const relevantChoice = lastTurnChoices.find(c => c.label === actionAttempt.actionAttempt);
          const difficultyLabel = relevantChoice ? relevantChoice.difficulty : 'normal';
          damage = this.DAMAGE_BY_DIFFICULTY[difficultyLabel as keyof typeof this.DAMAGE_BY_DIFFICULTY] || 2;
          if (actionAttempt.actionResult.impact === 'strong') {
            damage += 1;
          } else if (actionAttempt.actionResult.impact === 'extreme') {
            damage += 2;
          }
        }

        if (damage > 0) {
          actingChar.hp = Math.max(0, actingChar.hp - damage);
          if (actingChar.hp === 0) {
            actingChar.status = 'downed';
            actingChar.buffs = [];
          }
        }
      }

      this.decrementUsedBuffs(actingChar, actionAttempt.actionResult.statUsed);

      // Character revival from AI suggestion (perform action that narratively revives a downed party member)
      const revive = aiSuggestedChanges?.suggestedRevive as { characterName: string; hp: number } | null | undefined;
      if (revive && typeof revive === 'object' && revive.characterName) {
        const target = GameEngine.findCharacter(newState.party, revive.characterName);
        if (target && target.status === 'downed') {
          target.hp = Math.min(target.max_hp, Math.max(1, Math.round(revive.hp)));
          target.status = 'active';
          target.buffs = [];
        }
      }

      // HP healing — also handles downed targets in case AI used suggestedHeal instead of suggestedRevive
      const heals = aiSuggestedChanges?.suggestedHeal as Array<{ characterName: string; hp: number }> | null | undefined;
      if (Array.isArray(heals)) {
        for (const heal of heals) {
          const target = GameEngine.findCharacter(newState.party, heal.characterName);
          if (!target) {
            continue;
          }
          if (target.status === 'downed') {
            // AI should have used suggestedRevive but didn't — revive anyway
            target.hp = Math.min(target.max_hp, Math.max(1, Math.round(heal.hp)));
            target.status = 'active';
            target.buffs = [];
          } else {
            target.hp = Math.min(target.max_hp, target.hp + Math.max(0, Math.round(heal.hp)));
          }
        }
      }

      // Inventory remove from AI suggestion (trade/vendor — item given away)
      const remove = aiSuggestedChanges?.suggestedInventoryRemove as { characterName: string; itemName: string } | null | undefined;
      if (remove && typeof remove === 'object' && remove.characterName && remove.itemName) {
        const owner = GameEngine.findCharacter(newState.party, remove.characterName);
        if (owner) {
          const idx = owner.inventory.findIndex(i =>
            i.name.toLowerCase().includes(remove.itemName.toLowerCase()) ||
            remove.itemName.toLowerCase().includes(i.name.toLowerCase())
          );
          if (idx !== -1) {
            owner.inventory.splice(idx, 1);
          }
        }
      }

      // Inventory add from AI suggestion (assign id, optional targetCharacterName for trades)
      const item = aiSuggestedChanges?.suggestedInventoryAdd;
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        const newItem = item as Omit<InventoryItem, 'id'> & { targetCharacterName?: string; boundToCharacterName?: string };
        const { targetCharacterName, boundToCharacterName, ...itemData } = newItem;
        const recipient = targetCharacterName
          ? (GameEngine.findCharacter(newState.party, targetCharacterName) ?? actingChar)
          : actingChar;
        const boundToCharacter = typeof boundToCharacterName === 'string'
          ? GameEngine.findCharacter(newState.party, boundToCharacterName)
          : undefined;
        recipient.inventory.push({
          ...itemData,
          statBonuses: this.capItemStatBonuses(itemData.statBonuses),
          tags: this.cleanItemTags(itemData.tags),
          charges: typeof itemData.charges === 'number' ? Math.min(9, Math.max(0, Math.round(itemData.charges))) : undefined,
          boundToCharacterId: boundToCharacter?.id ?? itemData.boundToCharacterId,
          id: createId(),
        });
      }

      // Inventory update from AI suggestion (bless/enchant/reveal/damage an existing item)
      const update = aiSuggestedChanges?.suggestedInventoryUpdate as (Partial<InventoryItem> & {
        characterName?: string;
        itemName?: string;
        boundToCharacterName?: string;
      }) | null | undefined;
      if (update && typeof update === 'object' && update.characterName && update.itemName) {
        const owner = GameEngine.findCharacter(newState.party, update.characterName);
        if (owner) {
          const targetItem = owner.inventory.find(i =>
            i.name.toLowerCase().includes(update.itemName!.toLowerCase()) ||
            update.itemName!.toLowerCase().includes(i.name.toLowerCase())
          );
          if (targetItem) {
            if (typeof update.name === 'string' && update.name.trim()) {
              targetItem.name = update.name.trim();
            }
            if (typeof update.description === 'string' && update.description.trim()) {
              targetItem.description = update.description.trim();
            }
            if (update.statBonuses) {
              targetItem.statBonuses = this.capItemStatBonuses(update.statBonuses);
            }
            if (typeof update.healValue === 'number') {
              targetItem.healValue = Math.min(10, Math.max(0, Math.round(update.healValue)));
            }
            if (typeof update.consumable === 'boolean') {
              targetItem.consumable = update.consumable;
            }
            if (typeof update.transferable === 'boolean') {
              targetItem.transferable = update.transferable;
            }
            if (update.tags) {
              targetItem.tags = this.cleanItemTags(update.tags);
            }
            if (typeof update.effect === 'string') {
              targetItem.effect = update.effect.trim() || undefined;
            }
            if (typeof update.charges === 'number') {
              targetItem.charges = Math.min(9, Math.max(0, Math.round(update.charges)));
            }
            if (typeof update.condition === 'string') {
              targetItem.condition = update.condition.trim() || undefined;
            }
            if (typeof update.boundToCharacterName === 'string') {
              targetItem.boundToCharacterId = GameEngine.findCharacter(newState.party, update.boundToCharacterName)?.id;
            }
          }
        }
      }

      // Encounter: apply update first (damage/effects/status), then start if proposed
      const encounterUpdate = aiSuggestedChanges?.suggestedEncounterUpdate;
      if (encounterUpdate && typeof encounterUpdate === 'object' && newState.encounterState?.status === 'active') {
        newState.encounterState = applyEncounterUpdate(newState.encounterState, encounterUpdate as EncounterUpdateProposal);
      }

      const encounterStart = aiSuggestedChanges?.suggestedEncounterStart;
      if (encounterStart && typeof encounterStart === 'object' && !Array.isArray(encounterStart)) {
        const started = handleEncounterStart(
          encounterStart as EncounterStartProposal,
          newState.dmPrepEncounters,
          newState.encounterState,
        );
        if (started) {
          newState.encounterState = started;
        }
      }

      this.decrementTurnBuffs(actingChar);

      const buffRemove = aiSuggestedChanges?.suggestedBuffRemove as { characterName: string; buffName: string } | null | undefined;
      if (buffRemove && typeof buffRemove === 'object' && buffRemove.characterName && buffRemove.buffName) {
        const target = GameEngine.findCharacter(newState.party, buffRemove.characterName);
        if (target?.buffs?.length) {
          const buffName = this.normalize(buffRemove.buffName);
          target.buffs = target.buffs.filter(buff => this.normalize(buff.name) !== buffName);
        }
      }

      const buffAdds = aiSuggestedChanges?.suggestedBuffAdd as Array<{ characterName: string } & Omit<CharacterBuff, 'id'>> | null | undefined;
      if (Array.isArray(buffAdds)) {
        for (const buffAdd of buffAdds) {
          const target = GameEngine.findCharacter(newState.party, buffAdd.characterName);
          const cleaned = this.cleanBuff(buffAdd);
          if (target && target.status === 'active' && cleaned) {
            this.refreshOrAddBuff(target, cleaned);
          }
        }
      }

      // 3. TURN ROTATION (round-robin, skip downed)
      let nextIdx = (activeIdx + 1) % newState.party.length;
      let attempts = 0;
      while (newState.party[nextIdx].status === 'downed' && attempts < newState.party.length) {
        nextIdx = (nextIdx + 1) % newState.party.length;
        attempts++;
      }
      // If all downed, activeCharacterId stays as-is (wipe handled by caller)
      if (newState.party[nextIdx].status !== 'downed') {
        newState.activeCharacterId = newState.party[nextIdx].id;
      }
    }

    // 4. Scene Transition & Choices Update
    if (aiSuggestedChanges && Array.isArray(aiSuggestedChanges.choices)) {
      newState.lastChoices = aiSuggestedChanges.choices as Choice[];
    }

    if (aiSuggestedChanges && typeof aiSuggestedChanges.newScene === 'string') {
      newState.scene = aiSuggestedChanges.newScene;
      newState.sceneId = (aiSuggestedChanges.newSceneId as string) || createId();
    }

    return newState;
  }
}
