import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Character } from '../../types';
import { HelpSomeone } from './HelpSomeone';

const hero = (id: string, name: string, status: Character['status'] = 'active'): Character => ({
  id, name, class: 'Bard', species: 'Elf', quirk: '', hp: 5, max_hp: 10, status, stats: { might: 1, magic: 2, mischief: 3 }, inventory: [],
});

describe('HelpSomeone', () => {
  const party = [hero('a', 'Alice'), hero('b', 'Bram'), hero('c', 'Cora', 'downed')];

  it('offers a rally and bless/aid for each ally who can be helped', async () => {
    const onBless = vi.fn();
    const onAid = vi.fn();
    const onRally = vi.fn();
    render(<HelpSomeone party={party} activeCharacterId="a" disabled={false} onBless={onBless} onAid={onAid} onRally={onRally} />);

    await userEvent.click(screen.getByRole('button', { name: 'Help someone' }));
    expect(screen.getByText('Bram')).toBeInTheDocument();
    expect(screen.queryByText('Alice')).not.toBeInTheDocument();
    expect(screen.queryByText('Cora')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Aid Bram' }));
    expect(onAid).toHaveBeenCalledWith('b');
    expect(screen.queryByRole('group', { name: 'Help someone' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Help someone' }));
    await userEvent.click(screen.getByRole('button', { name: /Rally everyone/ }));
    expect(onRally).toHaveBeenCalled();
    expect(onBless).not.toHaveBeenCalled();
  });

  it('renders nothing without any support action', () => {
    const { container } = render(<HelpSomeone party={party} activeCharacterId="a" disabled={false} />);
    expect(container).toBeEmptyDOMElement();
  });
});
