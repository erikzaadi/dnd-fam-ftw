import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TargetPicker } from './TargetPicker';
import type { Character } from '../../types';

// imgSrc uses import.meta.env.BASE_URL which is not set in tests
vi.mock('../../lib/api', () => ({
  imgSrc: (url: string | null | undefined) => url ?? '/images/default_scene.png',
}));

const makeChar = (id: string, name: string, status: 'active' | 'downed' = 'active'): Character => ({
  id,
  name,
  status,
  avatarUrl: `/images/${id}.png`,
  class: 'Warrior',
  species: 'Human',
  quirk: '',
  hp: 10,
  max_hp: 10,
  stats: { might: 3, magic: 1, mischief: 2 },
  inventory: [],
});

const ALICE = makeChar('alice', 'Alice');
const BOB = makeChar('bob', 'Bob');
const CAROL = makeChar('carol', 'Carol');
const PARTY = [ALICE, BOB, CAROL];

describe('TargetPicker - full mode', () => {
  it('shows "Use on:" label for use action', () => {
    render(<TargetPicker party={PARTY} action="use" ownerCharId="alice" onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.getByText('Use on:')).toBeInTheDocument();
  });

  it('shows "Give to:" label for give action', () => {
    render(<TargetPicker party={PARTY} action="give" ownerCharId="alice" onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.getByText('Give to:')).toBeInTheDocument();
  });

  it('excludes owner from targets when action is give', () => {
    render(<TargetPicker party={PARTY} action="give" ownerCharId="alice" onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.queryByAltText('Alice')).not.toBeInTheDocument();
    expect(screen.getByAltText('Bob')).toBeInTheDocument();
    expect(screen.getByAltText('Carol')).toBeInTheDocument();
  });

  it('includes all party members when action is use', () => {
    render(<TargetPicker party={PARTY} action="use" ownerCharId="alice" onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.getByAltText('Alice')).toBeInTheDocument();
    expect(screen.getByAltText('Bob')).toBeInTheDocument();
    expect(screen.getByAltText('Carol')).toBeInTheDocument();
  });

  it('calls onConfirm with target id when avatar clicked', async () => {
    const onConfirm = vi.fn();
    render(<TargetPicker party={PARTY} action="use" ownerCharId="alice" onConfirm={onConfirm} onCancel={() => {}} />);
    await userEvent.click(screen.getByAltText('Bob').closest('button')!);
    expect(onConfirm).toHaveBeenCalledWith('bob');
  });

  it('calls onCancel when cancel button clicked', async () => {
    const onCancel = vi.fn();
    render(<TargetPicker party={PARTY} action="use" ownerCharId="alice" onConfirm={() => {}} onCancel={onCancel} />);
    await userEvent.click(screen.getByText('✕'));
    expect(onCancel).toHaveBeenCalled();
  });
});

describe('TargetPicker - compact mode', () => {
  it('renders without character name labels', () => {
    render(<TargetPicker compact party={PARTY} action="use" ownerCharId="alice" onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.queryByText('Alice')).not.toBeInTheDocument();
    expect(screen.queryByText('Bob')).not.toBeInTheDocument();
  });

  it('still excludes owner for give action in compact mode', () => {
    render(<TargetPicker compact party={PARTY} action="give" ownerCharId="bob" onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.queryByAltText('Bob')).not.toBeInTheDocument();
    expect(screen.getByAltText('Alice')).toBeInTheDocument();
  });
});

describe('TargetPicker - downed characters', () => {
  const DOWNED = makeChar('down', 'Down', 'downed');

  it('downed character is still rendered as a target for use', () => {
    render(<TargetPicker party={[ALICE, DOWNED]} action="use" ownerCharId="alice" onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.getByAltText('Down')).toBeInTheDocument();
  });

  it('downed character avatar has grayscale class', () => {
    render(<TargetPicker party={[ALICE, DOWNED]} action="use" ownerCharId="alice" onConfirm={() => {}} onCancel={() => {}} />);
    const img = screen.getByAltText('Down');
    expect(img.className).toContain('grayscale');
  });

  it('clicking a downed character still fires onConfirm', async () => {
    const onConfirm = vi.fn();
    render(<TargetPicker party={[ALICE, DOWNED]} action="use" ownerCharId="alice" onConfirm={onConfirm} onCancel={() => {}} />);
    await userEvent.click(screen.getByAltText('Down').closest('button')!);
    expect(onConfirm).toHaveBeenCalledWith('down');
  });
});

describe('TargetPicker - edge cases', () => {
  it('shows no targets when party is empty', () => {
    render(<TargetPicker party={[]} action="use" ownerCharId="alice" onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('shows no targets for give when only one member (the owner)', () => {
    render(<TargetPicker party={[ALICE]} action="give" ownerCharId="alice" onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.queryByAltText('Alice')).not.toBeInTheDocument();
  });
});
