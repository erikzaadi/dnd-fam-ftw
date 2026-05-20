import { describe, expect, it } from 'vitest';
import {
  sanitizeText,
  buildRollResultSegment,
  buildEncounterBoundarySegment,
  buildActiveCharacterSegment,
  buildChoicesSegment,
  buildGearSegment,
} from './carSpeechSegment';
import type { Session, TurnResult } from '../../types';

describe('carSpeechSegment', () => {
  describe('sanitizeText', () => {
    it('strips markdown, emojis and unicode symbols, collapses whitespace', () => {
      const input = '### Narration!\n\nThis is **bold** and *italic* and `code` with [link](url) 🐉.   Double spaces   here.';
      expect(sanitizeText(input)).toBe('Narration! This is bold and italic and code with link. Double spaces here.');
    });
  });

  describe('buildRollResultSegment', () => {
    it('builds segment for rolled action with success and HP changes', () => {
      const turn: TurnResult = {
        narration: '',
        imagePrompt: null,
        imageSuggested: false,
        choices: [],
        lastAction: {
          actionAttempt: 'Swing sword',
          actionResult: {
            success: true,
            roll: 15,
            statUsed: 'might',
          },
        },
        rollNarration: 'You swing hard and hit.',
        hpChanges: [
          { characterId: '1', characterName: 'Hagar', change: -3, newHp: 7, maxHp: 10 },
          { characterId: '2', characterName: 'Anya', change: 2, newHp: 10, maxHp: 10 },
        ],
      };
      const spoken = buildRollResultSegment(turn);
      expect(spoken).toContain('Rolled 15 on the dice. Success!');
      expect(spoken).toContain('You swing hard and hit.');
      expect(spoken).toContain('Hagar lost 3 H P. Anya gained 2 H P.');
    });

    it('skips roll result for sanctuary or no roll action', () => {
      const turn: TurnResult = {
        narration: '',
        imagePrompt: null,
        imageSuggested: false,
        choices: [],
        lastAction: null,
        rollNarration: 'A divine shield protects you.',
      };
      expect(buildRollResultSegment(turn)).toBe('A divine shield protects you.');
    });
  });

  describe('buildEncounterBoundarySegment', () => {
    it('detects encounter start', () => {
      expect(buildEncounterBoundarySegment('none', 'active', 'Goblin Ambush')).toBe('Encounter started. Goblin Ambush');
    });

    it('detects encounter finish', () => {
      expect(buildEncounterBoundarySegment('active', 'resolved', '', 'The goblins fled.')).toBe('Encounter finished. The goblins fled.');
    });
  });

  describe('buildActiveCharacterSegment', () => {
    it('builds segment with character name and class', () => {
      const session: Session = {
        id: '1',
        scene: 'Cave',
        turn: 1,
        displayName: 'Test Session',
        savingsMode: false,
        interventionState: { rescuesUsed: 0 },
        activeCharacterId: 'char-1',
        party: [
          {
            id: 'char-1',
            name: 'Hagar',
            class: 'Barbarian',
            species: 'Human',
            quirk: 'Angry',
            hp: 10,
            max_hp: 10,
            status: 'active',
            stats: { might: 3, magic: 0, mischief: 1 },
            inventory: [],
          },
        ],
      };
      expect(buildActiveCharacterSegment(session)).toBe("It is Hagar's move. They are a Barbarian.");
    });
  });

  describe('buildChoicesSegment', () => {
    it('builds numbered choices', () => {
      const choices = [
        { label: 'Attack', difficulty: 'normal' as const, stat: 'might' as const },
        { label: 'Run away', difficulty: 'easy' as const, stat: 'mischief' as const },
      ];
      expect(buildChoicesSegment(choices)).toBe('Option 1: Attack. Option 2: Run away.');
    });
  });

  describe('buildGearSegment', () => {
    it('reads active character first, then the rest', () => {
      const session: Session = {
        id: '1',
        scene: 'Cave',
        turn: 1,
        displayName: 'Test Session',
        savingsMode: false,
        interventionState: { rescuesUsed: 0 },
        activeCharacterId: 'char-1',
        party: [
          {
            id: 'char-1',
            name: 'Hagar',
            class: 'Barbarian',
            species: 'Human',
            quirk: 'Angry',
            hp: 10,
            max_hp: 10,
            status: 'active',
            stats: { might: 3, magic: 0, mischief: 1 },
            inventory: [{ id: 'i1', name: 'Sword', description: 'Sharp blade', effect: 'Do damage' }],
          },
          {
            id: 'char-2',
            name: 'Anya',
            class: 'Mage',
            species: 'Elf',
            quirk: 'Studious',
            hp: 8,
            max_hp: 8,
            status: 'active',
            stats: { might: 0, magic: 3, mischief: 1 },
            inventory: [{ id: 'i2', name: 'Staff', description: 'Wooden stick' }],
          },
        ],
      };
      const spoken = buildGearSegment(session);
      expect(spoken).toContain('Your character, Hagar, has the following items: Sword. Sharp blade, effect: Do damage.');
      expect(spoken).toContain('Anya has the following items: Staff. Wooden stick.');
    });
  });
});
