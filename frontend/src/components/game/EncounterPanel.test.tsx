import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EncounterPanel } from './EncounterPanel';
import type { EncounterState } from '../../types';

const makeEncounter = (overrides: Partial<EncounterState> = {}): EncounterState => ({
  id: 'enc-1',
  name: 'Goblin Brawl',
  status: 'active',
  round: 2,
  enemies: [
    {
      id: 'enemy-1',
      name: 'Goblin Chief',
      role: 'boss',
      hp: 12,
      maxHp: 20,
      status: 'active',
    },
  ],
  areas: [],
  ...overrides,
});

describe('EncounterPanel', () => {
  it('renders encounter name and round', () => {
    render(<EncounterPanel encounter={makeEncounter()} />);
    expect(screen.getByText('Goblin Brawl')).toBeTruthy();
    expect(screen.getByText('Round 2')).toBeTruthy();
  });

  it('renders enemy name and role', () => {
    render(<EncounterPanel encounter={makeEncounter()} />);
    expect(screen.getByText('Goblin Chief')).toBeTruthy();
    expect(screen.getByText('[Boss]')).toBeTruthy();
  });

  it('shows HP bar for active enemy', () => {
    render(<EncounterPanel encounter={makeEncounter()} />);
    const bar = screen.getByRole('progressbar', { name: /Goblin Chief HP/i });
    expect(bar).toBeTruthy();
  });

  it('shows wounded label for 50-75% HP', () => {
    const enc = makeEncounter({
      enemies: [{ id: 'e1', name: 'Guard', role: 'standard', hp: 4, maxHp: 6, status: 'active' }],
    });
    render(<EncounterPanel encounter={enc} />);
    expect(screen.getByText('Wounded')).toBeTruthy();
  });

  it('shows staggering label for 25-50% HP', () => {
    const enc = makeEncounter({
      enemies: [{ id: 'e1', name: 'Guard', role: 'standard', hp: 2, maxHp: 6, status: 'active' }],
    });
    render(<EncounterPanel encounter={enc} />);
    expect(screen.getByText('Staggering')).toBeTruthy();
  });

  it('shows nearly broken label for below 25% HP', () => {
    const enc = makeEncounter({
      enemies: [{ id: 'e1', name: 'Guard', role: 'standard', hp: 1, maxHp: 6, status: 'active' }],
    });
    render(<EncounterPanel encounter={enc} />);
    expect(screen.getByText('Nearly Broken')).toBeTruthy();
  });

  it('shows defeated label for HP 0', () => {
    const enc = makeEncounter({
      enemies: [{ id: 'e1', name: 'Guard', role: 'standard', hp: 0, maxHp: 6, status: 'defeated' }],
    });
    render(<EncounterPanel encounter={enc} />);
    expect(screen.getByText('Defeated')).toBeTruthy();
  });

  it('shows fled status', () => {
    const enc = makeEncounter({
      enemies: [{ id: 'e1', name: 'Goblin Scout', role: 'minion', hp: 0, maxHp: 2, status: 'fled' }],
    });
    render(<EncounterPanel encounter={enc} />);
    expect(screen.getByText('Fled')).toBeTruthy();
  });

  it('shows revealed weaknesses as tags', () => {
    const enc = makeEncounter({
      enemies: [{
        id: 'e1',
        name: 'Vine Beast',
        role: 'standard',
        hp: 6,
        maxHp: 6,
        status: 'active',
        weaknesses: [
          { id: 'w1', label: 'fire', school: 'fire', revealed: true },
          { id: 'w2', label: 'cold', school: 'frost', revealed: false },
        ],
      }],
    });
    render(<EncounterPanel encounter={enc} />);
    expect(screen.getByText(/fire/i)).toBeTruthy();
    expect(screen.queryByText(/cold/i)).toBeNull();
  });

  it('does not show broken weaknesses', () => {
    const enc = makeEncounter({
      enemies: [{
        id: 'e1',
        name: 'Vine Beast',
        role: 'standard',
        hp: 6,
        maxHp: 6,
        status: 'active',
        weaknesses: [
          { id: 'w1', label: 'fire', school: 'fire', revealed: true, broken: true },
        ],
      }],
    });
    render(<EncounterPanel encounter={enc} />);
    expect(screen.queryByText(/fire/i)).toBeNull();
  });

  it('shows active enemy effects with remaining turns', () => {
    const enc = makeEncounter({
      enemies: [{
        id: 'e1',
        name: 'Guard',
        role: 'standard',
        hp: 5,
        maxHp: 6,
        status: 'active',
        effects: [{ id: 'ef1', name: 'Burning', description: 'On fire', kind: 'damage_over_time', remainingTurns: 2 }],
      }],
    });
    render(<EncounterPanel encounter={enc} />);
    expect(screen.getByText(/Burning \(2\)/)).toBeTruthy();
  });

  it('shows encounter objective when set', () => {
    const enc = makeEncounter({ objective: 'Defeat the chief' });
    render(<EncounterPanel encounter={enc} />);
    expect(screen.getByText('Defeat the chief')).toBeTruthy();
  });

  it('shows encounter areas', () => {
    const enc = makeEncounter({
      areas: [
        { id: 'a1', label: 'Broken Crates', description: 'Splintered wood', tags: ['cover'] },
        { id: 'a2', label: 'Torch Sconce', description: 'Lit torch', tags: ['fire'] },
      ],
    });
    render(<EncounterPanel encounter={enc} />);
    expect(screen.getByText('Broken Crates')).toBeTruthy();
    expect(screen.getByText('Torch Sconce')).toBeTruthy();
  });

  it('renders multiple enemies', () => {
    const enc = makeEncounter({
      enemies: [
        { id: 'e1', name: 'Goblin A', role: 'minion', hp: 2, maxHp: 2, status: 'active' },
        { id: 'e2', name: 'Goblin B', role: 'minion', hp: 0, maxHp: 2, status: 'defeated' },
      ],
    });
    render(<EncounterPanel encounter={enc} />);
    expect(screen.getByText('Goblin A')).toBeTruthy();
    expect(screen.getByText('Goblin B')).toBeTruthy();
    expect(screen.getByText('Fresh')).toBeTruthy();
    expect(screen.getByText('Defeated')).toBeTruthy();
  });
});
