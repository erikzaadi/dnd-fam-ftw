import { describe, expect, it } from 'vitest';
import {
  narrationAgentOutputSchema,
  choicesAgentOutputSchema,
  combatAgentOutputSchema,
  inventoryAgentOutputSchema,
  recoveryAgentOutputSchema,
} from './agentSchemas.js';

const validChoice = {
  label: 'Charge the gate',
  difficulty: 'normal' as const,
  stat: 'might' as const,
  difficultyValue: 12,
};

describe('narrationAgentOutputSchema', () => {
  it('accepts minimal valid output', () => {
    const result = narrationAgentOutputSchema.safeParse({
      narration: 'The party advances into the dark hall.',
      currentTensionLevel: 'medium',
    });
    expect(result.success).toBe(true);
  });

  it('accepts rollNarration when present', () => {
    const result = narrationAgentOutputSchema.safeParse({
      rollNarration: 'A solid hit, landed clean.',
      narration: 'The goblin staggers backward.',
      currentTensionLevel: 'high',
    });
    expect(result.success).toBe(true);
  });

  it('defaults currentTensionLevel to medium when omitted', () => {
    const result = narrationAgentOutputSchema.safeParse({
      narration: 'Something stirs in the shadows.',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.currentTensionLevel).toBe('medium');
    }
  });

  it('rejects empty narration', () => {
    const result = narrationAgentOutputSchema.safeParse({
      narration: '',
      currentTensionLevel: 'medium',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid tension level', () => {
    const result = narrationAgentOutputSchema.safeParse({
      narration: 'The corridor narrows.',
      currentTensionLevel: 'extreme',
    });
    expect(result.success).toBe(false);
  });
});

describe('choicesAgentOutputSchema', () => {
  it('accepts exactly 3 valid choices', () => {
    const result = choicesAgentOutputSchema.safeParse({
      choices: [
        validChoice,
        { label: 'Search the walls', difficulty: 'easy', stat: 'mischief', difficultyValue: 9 },
        { label: 'Cast light', difficulty: 'normal', stat: 'magic', difficultyValue: 11 },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects fewer than 3 choices', () => {
    const result = choicesAgentOutputSchema.safeParse({
      choices: [validChoice, validChoice],
    });
    expect(result.success).toBe(false);
  });

  it('rejects more than 3 choices', () => {
    const result = choicesAgentOutputSchema.safeParse({
      choices: [validChoice, validChoice, validChoice, validChoice],
    });
    expect(result.success).toBe(false);
  });

  it('rejects choices missing difficultyValue', () => {
    const result = choicesAgentOutputSchema.safeParse({
      choices: [
        { label: 'Rush in', difficulty: 'hard', stat: 'might' },
        validChoice,
        validChoice,
      ],
    });
    expect(result.success).toBe(false);
  });
});

describe('combatAgentOutputSchema', () => {
  it('accepts null output (no combat state change)', () => {
    const result = combatAgentOutputSchema.safeParse({
      suggestedDamage: null,
      suggestedEncounterStart: null,
      suggestedEncounterUpdate: null,
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid damage only', () => {
    const result = combatAgentOutputSchema.safeParse({
      suggestedDamage: 3,
      suggestedEncounterStart: null,
      suggestedEncounterUpdate: null,
    });
    expect(result.success).toBe(true);
  });

  it('accepts encounter update with enemy damage', () => {
    const result = combatAgentOutputSchema.safeParse({
      suggestedDamage: 0,
      suggestedEncounterStart: null,
      suggestedEncounterUpdate: {
        enemyDamage: [{ enemyName: 'Goblin Chief', amount: 4, reason: 'Direct hit' }],
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects damage above 20', () => {
    const result = combatAgentOutputSchema.safeParse({
      suggestedDamage: 21,
      suggestedEncounterStart: null,
      suggestedEncounterUpdate: null,
    });
    expect(result.success).toBe(false);
  });
});

describe('inventoryAgentOutputSchema', () => {
  it('accepts all-null output (no inventory change)', () => {
    const result = inventoryAgentOutputSchema.safeParse({
      suggestedInventoryAdd: null,
      suggestedInventoryRemove: null,
      suggestedInventoryUpdate: null,
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid item add', () => {
    const result = inventoryAgentOutputSchema.safeParse({
      suggestedInventoryAdd: {
        name: '⚔️ Iron Sword',
        description: 'A standard iron sword.',
        statBonuses: { might: 1 },
      },
      suggestedInventoryRemove: null,
      suggestedInventoryUpdate: null,
    });
    expect(result.success).toBe(true);
  });

  it('rejects item add missing name', () => {
    const result = inventoryAgentOutputSchema.safeParse({
      suggestedInventoryAdd: {
        description: 'Mystery item.',
        statBonuses: {},
      },
      suggestedInventoryRemove: null,
      suggestedInventoryUpdate: null,
    });
    expect(result.success).toBe(false);
  });
});

describe('recoveryAgentOutputSchema', () => {
  it('accepts all-null output (no recovery)', () => {
    const result = recoveryAgentOutputSchema.safeParse({
      suggestedRevive: null,
      suggestedHeal: null,
      suggestedBuffAdd: null,
      suggestedBuffRemove: null,
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid heal array', () => {
    const result = recoveryAgentOutputSchema.safeParse({
      suggestedRevive: null,
      suggestedHeal: [{ characterName: 'Pip', hp: 4 }],
      suggestedBuffAdd: null,
      suggestedBuffRemove: null,
    });
    expect(result.success).toBe(true);
  });

  it('accepts single buff object and wraps it in array', () => {
    const result = recoveryAgentOutputSchema.safeParse({
      suggestedRevive: null,
      suggestedHeal: null,
      suggestedBuffAdd: {
        characterName: 'Pip',
        name: 'Blessed',
        description: 'Divine favour.',
        kind: 'buff',
        statBonuses: { magic: 1 },
        remainingTurns: 2,
      },
      suggestedBuffRemove: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(Array.isArray(result.data.suggestedBuffAdd)).toBe(true);
    }
  });

  it('rejects revive with hp of 0', () => {
    const result = recoveryAgentOutputSchema.safeParse({
      suggestedRevive: { characterName: 'Pip', hp: 0 },
      suggestedHeal: null,
      suggestedBuffAdd: null,
      suggestedBuffRemove: null,
    });
    expect(result.success).toBe(false);
  });
});
