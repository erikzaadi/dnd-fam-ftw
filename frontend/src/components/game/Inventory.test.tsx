import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Inventory } from './Inventory';
import type { Character } from '../../types';

vi.mock('../../lib/api', () => ({
  imgSrc: (url: string | null | undefined) => url ?? '/images/default_scene.png',
}));

const makeChar = (id: string, name: string, inventory: Character['inventory'] = []): Character => ({
  id,
  name,
  class: 'Warrior',
  species: 'Human',
  quirk: '',
  hp: 10,
  max_hp: 10,
  status: 'active',
  avatarUrl: `/images/${id}.png`,
  stats: { might: 3, magic: 1, mischief: 2 },
  inventory,
});

const PARTY = [
  makeChar('alice', 'Alice', [
    {
      id: 'moon-key',
      name: 'Moon Key',
      description: 'A silver key with a moon-shaped bow.',
      transferable: true,
    },
  ]),
  makeChar('bob', 'Bob'),
];

describe('Inventory', () => {
  it('keeps the give target picker open and submits the selected target', async () => {
    const onGiveItem = vi.fn();
    render(
      <Inventory
        party={PARTY}
        activeCharacterId="alice"
        onGiveItem={onGiveItem}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: 'Give' }));

    expect(screen.getByText('Give to:')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Give to:')).toBeInTheDocument());

    await userEvent.click(screen.getByAltText('Bob').closest('button')!);

    expect(onGiveItem).toHaveBeenCalledWith('alice', 'moon-key', 'bob');
  });

  it('shows the Give button when transferable is undefined (defaults to giveable)', () => {
    const party = [
      makeChar('alice', 'Alice', [
        {
          id: 'moon-key',
          name: 'Moon Key',
          description: 'A silver key with a moon-shaped bow.',
        },
      ]),
      makeChar('bob', 'Bob'),
    ];
    render(
      <Inventory
        party={party}
        activeCharacterId="alice"
        onGiveItem={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: 'Give' })).toBeInTheDocument();
  });

  it('hides the Give button when the item is explicitly not transferable', () => {
    const party = [
      makeChar('alice', 'Alice', [
        {
          id: 'cursed-ring',
          name: 'Cursed Ring',
          description: 'It will not come off.',
          transferable: false,
        },
      ]),
      makeChar('bob', 'Bob'),
    ];
    render(
      <Inventory
        party={party}
        activeCharacterId="alice"
        onGiveItem={vi.fn()}
      />
    );

    expect(screen.queryByRole('button', { name: 'Give' })).not.toBeInTheDocument();
  });
});
