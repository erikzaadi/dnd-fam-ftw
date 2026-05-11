import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { RollBreakdown } from './RollBreakdown';
import { formatBuffBonusLabel, formatCharacterBonusLabel, formatChoiceItemBonusLabel, formatHelperBonusLabel } from './rollBonusLabels';

vi.mock('../../lib/api', () => ({
  imgSrc: (url: string) => url,
}));

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

  it('renders buff bonus with its resolved label', () => {
    expect(formatBuffBonusLabel(1, 'Blessed')).toBe('1 Blessed');
  });

  it('renders curse penalty with its resolved label', () => {
    expect(formatBuffBonusLabel(-1, 'Jinxed')).toBe('-1 Jinxed');
  });

  it('shows buff bonus in the roll breakdown', () => {
    render(createElement(RollBreakdown, {
      roll: 10,
      statBonus: 2,
      buffBonus: 1,
      buffBonusLabel: 'Blessed',
      success: true,
    }));

    expect(screen.getByText('1 Blessed')).toBeInTheDocument();
    expect(screen.getByText('13')).toBeInTheDocument();
  });

  it('shows curse penalty in the roll breakdown', () => {
    render(createElement(RollBreakdown, {
      roll: 10,
      statBonus: 2,
      buffBonus: -1,
      buffBonusLabel: 'Jinxed',
      success: false,
    }));

    expect(screen.getByText('-1 Jinxed')).toBeInTheDocument();
    expect(screen.getByText('11')).toBeInTheDocument();
  });
});
