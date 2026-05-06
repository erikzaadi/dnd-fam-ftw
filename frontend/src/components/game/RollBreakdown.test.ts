import { describe, expect, it } from 'vitest';
import { formatCharacterBonusLabel, formatChoiceItemBonusLabel, formatHelperBonusLabel } from './rollBonusLabels';

describe('roll bonus label formatting', () => {
  it('renders helper bonus with the helper first name', () => {
    expect(formatHelperBonusLabel(2, 'Pip Gearwise')).toBe('2 help (Pip)');
  });

  it('renders gear bonus with the gear emoji and short name inside parentheses', () => {
    expect(formatChoiceItemBonusLabel(2, '🌙 Moon Lens')).toBe('2 gear (🌙 Moon)');
  });

  it('renders gear bonus without parentheses when no item name is available', () => {
    expect(formatChoiceItemBonusLabel(2)).toBe('2 gear');
  });

  it('renders character edge bonus with its resolved label', () => {
    expect(formatCharacterBonusLabel(2, 'social edge')).toBe('2 social edge');
  });
});
