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

  public static resolveAction(
    character: Character, 
    action: string, 
    statName: 'might' | 'magic' | 'mischief' | 'none',
    difficulty: 'easy' | 'normal' | 'hard' = 'normal'
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
    const success = this.checkSuccess(total + itemBonus, difficulty);

    return {
      actionAttempt: action,
      actionResult: {
        success,
        roll,
        statUsed: statName,
        ...(itemBonus > 0 && { itemBonus }),
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
        // Find who acted
        const activeIdx = newState.party.findIndex(c => c.id === state.activeCharacterId);
        const actingChar = activeIdx !== -1 ? newState.party[activeIdx] : newState.party[0];

        // HP Damage on failure - Increased Stakes
        if (!actionAttempt.actionResult.success && actionAttempt.actionResult.statUsed !== 'none') {
            // Find the difficulty of the action to determine damage
            const lastTurnChoices = state.lastChoices || [];
            const relevantChoice = lastTurnChoices.find(c => c.label === actionAttempt.actionAttempt);
            const difficultyLabel = relevantChoice ? relevantChoice.difficulty : 'normal';
            
            let damage = this.DAMAGE_BY_DIFFICULTY[difficultyLabel as keyof typeof this.DAMAGE_BY_DIFFICULTY] || 2;
            
            // Critical Failure: Natural 1 means +1 extra damage
            if (actionAttempt.actionResult.roll === 1) {
              damage += 1;
            }

            actingChar.hp = Math.max(0, actingChar.hp - damage);
        }

        // Inventory
        const item = aiSuggestedChanges?.suggestedInventoryAdd;
        if (item && typeof item === 'object' && !Array.isArray(item)) {
            actingChar.inventory.push(item as InventoryItem);
        }

        // 3. TURN ROTATION (Round Robin)
        const nextIdx = (activeIdx + 1) % newState.party.length;
        newState.activeCharacterId = newState.party[nextIdx].id;
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
