import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CharacterPopup } from './CharacterPopup';
import type { Character } from '../types';

vi.mock('../lib/api', () => ({
  imgSrc: (url: string | null | undefined) => url ?? '/images/default_scene.png',
}));

const character: Character = {
  id: 'brom',
  name: 'Brom',
  class: 'Warrior',
  species: 'Human',
  quirk: 'Always polishes his shield',
  hp: 10,
  max_hp: 10,
  status: 'active',
  avatarUrl: '/images/brom.png',
  stats: { might: 3, magic: 1, mischief: 1 },
  inventory: [],
  buffs: [
    {
      id: 'blessed',
      name: 'Blessed',
      kind: 'buff',
      description: 'A warm glow steadies Brom.',
      statBonuses: { might: 1 },
      remainingTurns: 2,
    },
    {
      id: 'jinxed',
      name: 'Jinxed',
      kind: 'curse',
      description: 'Bad luck clings to Brom.',
      statBonuses: { mischief: -1 },
      remainingUses: 1,
    },
  ],
};

describe('CharacterPopup', () => {
  it('shows active effects in character details', () => {
    render(
      <CharacterPopup
        character={character}
        onClose={vi.fn()}
        onAvatarClick={vi.fn()}
      />
    );

    expect(screen.getByText('Effects')).toBeInTheDocument();
    expect(screen.getByText('Blessed +1 Might · 2 turns')).toBeInTheDocument();
    expect(screen.getByText('Jinxed -1 Mischief · 1 use')).toBeInTheDocument();
  });
});
