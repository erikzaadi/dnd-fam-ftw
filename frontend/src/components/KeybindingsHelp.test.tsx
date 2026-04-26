import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { KeybindingsHelp } from './KeybindingsHelp';

const BINDINGS = [
  { key: '1', action: 'First action' },
  { key: '2', action: 'Second action' },
];

describe('KeybindingsHelp', () => {
  it('renders all bindings', () => {
    render(<KeybindingsHelp bindings={BINDINGS} onClose={() => {}} />);
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('First action')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('Second action')).toBeInTheDocument();
  });

  it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn();
    render(<KeybindingsHelp bindings={BINDINGS} onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when ? is pressed', () => {
    const onClose = vi.fn();
    render(<KeybindingsHelp bindings={BINDINGS} onClose={onClose} />);
    fireEvent.keyDown(window, { key: '?' });
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when backdrop is clicked', () => {
    const onClose = vi.fn();
    const { container } = render(<KeybindingsHelp bindings={BINDINGS} onClose={onClose} />);
    fireEvent.click(container.firstElementChild!);
    expect(onClose).toHaveBeenCalled();
  });

  it('does not close when inner panel is clicked', () => {
    const onClose = vi.fn();
    render(<KeybindingsHelp bindings={BINDINGS} onClose={onClose} />);
    fireEvent.click(screen.getByText('Keyboard Shortcuts'));
    expect(onClose).not.toHaveBeenCalled();
  });
});
