import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CharacterForm } from './CharacterForm';

describe('CharacterForm', () => {
  it('fills fields from each preset', () => {
    const { container } = render(<CharacterForm onSave={vi.fn()} onCancel={vi.fn()} isLoading={false} />);

    const presets = [
      ['Blade Hero', 'Knight', '5', '1', '1'],
      ['Sharpshot', 'Ranger', '2', '1', '4'],
      ['Spell Slinger', 'Wizard', '1', '5', '1'],
      ['Light Keeper', 'Cleric', '2', '4', '1'],
      ['Shield Bearer', 'Guardian', '4', '2', '1'],
      ['Story Singer', 'Bard', '1', '2', '4'],
    ];

    for (const [label, className, might, magic, mischief] of presets) {
      fireEvent.click(screen.getByText(label));
      expect((container.querySelector('input[name="class"]') as HTMLInputElement).value).toBe(className);
      expect((container.querySelector('input[name="might"]') as HTMLInputElement).type).toBe('hidden');
      expect((container.querySelector('input[name="might"]') as HTMLInputElement).value).toBe(might);
      expect((container.querySelector('input[name="magic"]') as HTMLInputElement).value).toBe(magic);
      expect((container.querySelector('input[name="mischief"]') as HTMLInputElement).value).toBe(mischief);
      expect(screen.getByText(new RegExp(`Might ${might} / Magic ${magic} / Mischief ${mischief}`))).toBeInTheDocument();
    }
  });

  it('manual preset does not overwrite custom fields', () => {
    render(<CharacterForm onSave={vi.fn()} onCancel={vi.fn()} isLoading={false} />);

    const classInput = screen.getByPlaceholderText('Brave Knight / Chaotic Wizard');
    fireEvent.change(classInput, { target: { value: 'Snack Detective' } });
    fireEvent.click(screen.getByText('Manual'));

    expect(screen.getByDisplayValue('Snack Detective')).toBeInTheDocument();
  });
});
