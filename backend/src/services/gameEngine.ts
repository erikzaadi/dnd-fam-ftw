import { Character, SessionState, ActionAttempt, InventoryItem, Choice } from '../types.js';

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

  public static rollDice(stat: number): { roll: number; total: number } {
    const roll = Math.floor(Math.random() * 20) + 1;
    return { roll, total: roll + stat };
  }

  public static checkSuccess(total: number, difficultyLabel: 'easy' | 'normal' | 'hard' | number): boolean {
    const difficulty = typeof difficultyLabel === 'number'
      ? difficultyLabel
      : (this.DIFFICULTIES[difficultyLabel] || 12);
    return total >= difficulty;
  }

  public static isPartyWiped(state: SessionState): boolean {
    return state.party.length > 0 && state.party.every(c => c.status === 'downed');
  }

  public static applySanctuaryRecovery(state: SessionState): SessionState {
    const newState: SessionState = JSON.parse(JSON.stringify(state));
    for (const char of newState.party) {
      if (char.status === 'downed') {
        char.status = 'active';
        char.hp = 1;
      }
    }
    if (newState.party.length > 0) {
      newState.activeCharacterId = newState.party[0].id;
    }
    return newState;
  }

  public static applyIntervention(state: SessionState): SessionState {
    const newState: SessionState = JSON.parse(JSON.stringify(state));
    for (const char of newState.party) {
      if (char.status === 'downed') {
        char.status = 'active';
        char.hp = 1;
      }
    }
    newState.interventionState = { used: true };
    // Reset active character to the first one
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
    statName: 'might' | 'magic' | 'mischief' | 'none',
    difficulty: 'easy' | 'normal' | 'hard' = 'normal',
    difficultyValue?: number
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
    const { roll, total } = this.rollDice(statValue);
    const target = difficultyValue ?? this.DIFFICULTIES[difficulty] ?? 12;
    const success = this.checkSuccess(total + itemBonus, target);
    const isCritical = roll === 20;

    return {
      actionAttempt: action,
      actionResult: {
        success,
        roll,
        statUsed: statName,
        statBonus: statValue,
        difficultyTarget: target,
        ...(itemBonus > 0 && { itemBonus }),
        ...(isCritical && { isCritical: true }),
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
          // Critical Failure: Natural 1 means +1 extra damage
          if (actionAttempt.actionResult.roll === 1) {
            damage += 1;
          }
        }

        if (damage > 0) {
          actingChar.hp = Math.max(0, actingChar.hp - damage);
          if (actingChar.hp === 0) {
            actingChar.status = 'downed';
          }
        }
      }

      // Character revival from AI suggestion (perform action that narratively revives a downed party member)
      const revive = aiSuggestedChanges?.suggestedRevive as { characterName: string; hp: number } | null | undefined;
      if (revive && typeof revive === 'object' && revive.characterName) {
        const target = GameEngine.findCharacter(newState.party, revive.characterName);
        if (target && target.status === 'downed') {
          target.hp = Math.min(target.max_hp, Math.max(1, Math.round(revive.hp)));
          target.status = 'active';
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
        const newItem = item as Omit<InventoryItem, 'id'> & { targetCharacterName?: string };
        const { targetCharacterName, ...itemData } = newItem;
        const recipient = targetCharacterName
          ? (GameEngine.findCharacter(newState.party, targetCharacterName) ?? actingChar)
          : actingChar;
        recipient.inventory.push({
          ...itemData,
          id: Math.random().toString(36).substring(7),
        });
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
      newState.sceneId = (aiSuggestedChanges.newSceneId as string) || Math.random().toString(36).substring(7);
    }

    return newState;
  }
}
