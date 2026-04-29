import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StatsPanel } from './StatsPanel';
import type { Character } from '../../types';

vi.mock('../../lib/api', () => ({
  imgSrc: (url: string | null | undefined) => url ?? '',
}));

const makeChar = (overrides: Partial<Character> = {}): Character => ({
  id: 'char-1',
  name: 'Aria',
  class: 'Rogue',
  species: 'Elf',
  quirk: 'sneaky',
  hp: 10,
  max_hp: 10,
  status: 'active',
  stats: { might: 2, magic: 3, mischief: 5 },
  inventory: [],
  ...overrides,
});

const BASE_CHAR = makeChar();

const renderPanel = (overrides: Partial<Parameters<typeof StatsPanel>[0]> = {}) => {
  const onShowPartyGear = vi.fn();
  render(
    <StatsPanel
      character={BASE_CHAR}
      onShowPartyGear={onShowPartyGear}
      {...overrides}
    />
  );
  return { onShowPartyGear };
};

describe('StatsPanel stat totals', () => {
  it('renders all three stat names', () => {
    renderPanel();
    expect(screen.getByText('might')).toBeInTheDocument();
    expect(screen.getByText('magic')).toBeInTheDocument();
    expect(screen.getByText('mischief')).toBeInTheDocument();
  });

  it('shows base stat values when no bonuses', () => {
    renderPanel();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('shows total (base + bonus) when items grant bonuses', () => {
    const char = makeChar({
      stats: { might: 2, magic: 3, mischief: 5 },
      inventory: [
        {
          id: 'item-1',
          name: 'Shadow Cloak',
          description: '+2 mischief',
          statBonuses: { mischief: 2 },
        },
      ],
    });
    renderPanel({ character: char });
    expect(screen.getByText('7')).toBeInTheDocument();
  });
});

describe('StatsPanel buffed stat display', () => {
  it('shows no chevron when no bonuses', () => {
    renderPanel();
    expect(screen.queryByText('›')).not.toBeInTheDocument();
  });

  it('shows a chevron only on the buffed stat', () => {
    const char = makeChar({
      inventory: [{ id: 'i1', name: 'Cloak', description: '', statBonuses: { mischief: 2 } }],
    });
    renderPanel({ character: char });
    expect(screen.getAllByText('›')).toHaveLength(1);
  });

  it('renders buffed stat row as a button', () => {
    const char = makeChar({
      inventory: [{ id: 'i1', name: 'Cloak', description: '', statBonuses: { mischief: 2 } }],
    });
    renderPanel({ character: char });
    expect(screen.getByRole('button', { name: /mischief/i })).toBeInTheDocument();
  });

  it('does not render unbuffed stat rows as buttons', () => {
    const char = makeChar({
      inventory: [{ id: 'i1', name: 'Cloak', description: '', statBonuses: { mischief: 2 } }],
    });
    renderPanel({ character: char });
    expect(screen.queryByRole('button', { name: /might/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /magic/i })).not.toBeInTheDocument();
  });
});

describe('StatsPanel expandable stat rows', () => {
  const charWithBonus = makeChar({
    stats: { might: 2, magic: 3, mischief: 5 },
    inventory: [
      { id: 'i1', name: 'Shadow Cloak', description: '', statBonuses: { mischief: 2 } },
      { id: 'i2', name: 'Faction Arrow', description: '', statBonuses: { mischief: 1 } },
    ],
  });

  it('does not show breakdown by default', () => {
    renderPanel({ character: charWithBonus });
    expect(screen.queryByText('5 base')).not.toBeInTheDocument();
  });

  it('shows breakdown after clicking the buffed stat button', () => {
    renderPanel({ character: charWithBonus });
    fireEvent.click(screen.getByRole('button', { name: /mischief/i }));
    expect(screen.getByText('5 base')).toBeInTheDocument();
    expect(screen.getByText(/Shadow Cloak/)).toBeInTheDocument();
    expect(screen.getByText(/Faction Arrow/)).toBeInTheDocument();
  });

  it('sets aria-expanded to false by default', () => {
    renderPanel({ character: charWithBonus });
    expect(screen.getByRole('button', { name: /mischief/i })).toHaveAttribute('aria-expanded', 'false');
  });

  it('sets aria-expanded to true when expanded', () => {
    renderPanel({ character: charWithBonus });
    const btn = screen.getByRole('button', { name: /mischief/i });
    fireEvent.click(btn);
    expect(btn).toHaveAttribute('aria-expanded', 'true');
  });

  it('collapses on second click', () => {
    renderPanel({ character: charWithBonus });
    const btn = screen.getByRole('button', { name: /mischief/i });
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(screen.queryByText('5 base')).not.toBeInTheDocument();
    expect(btn).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('StatsPanel active stat highlight', () => {
  it('applies highlight class to the active stat row', () => {
    const { container } = render(
      <StatsPanel
        character={BASE_CHAR}
        onShowPartyGear={vi.fn()}
        activeStatKey="magic"
      />
    );
    const highlighted = container.querySelector('.ring-1');
    expect(highlighted).toBeInTheDocument();
  });

  it('does not apply highlight when activeStatKey is null', () => {
    const { container } = render(
      <StatsPanel
        character={BASE_CHAR}
        onShowPartyGear={vi.fn()}
        activeStatKey={null}
      />
    );
    expect(container.querySelector('.ring-1')).not.toBeInTheDocument();
  });
});

describe('StatsPanel gear button', () => {
  it('renders the gear button', () => {
    renderPanel();
    expect(screen.getByRole('button', { name: /gear/i })).toBeInTheDocument();
  });

  it('calls onShowPartyGear when gear button is clicked', () => {
    const { onShowPartyGear } = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /gear/i }));
    expect(onShowPartyGear).toHaveBeenCalledOnce();
  });
});
