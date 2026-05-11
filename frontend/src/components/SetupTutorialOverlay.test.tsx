import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SetupTutorialOverlay } from './SetupTutorialOverlay';

const step = {
  id: 'one',
  selector: '[data-test-anchor]',
  title: 'Setup Help',
  body: 'This explains the setup screen.',
};

describe('SetupTutorialOverlay', () => {
  it('renders nothing without a step', () => {
    const { container } = render(
      <SetupTutorialOverlay step={null} stepNumber={0} totalSteps={0} onAdvance={vi.fn()} onDismiss={vi.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('advances and dismisses', () => {
    const onAdvance = vi.fn();
    const onDismiss = vi.fn();
    render(
      <>
        <div data-test-anchor />
        <SetupTutorialOverlay step={step} stepNumber={1} totalSteps={2} onAdvance={onAdvance} onDismiss={onDismiss} />
      </>
    );

    expect(screen.getByText('Setup Help')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(onAdvance).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss setup tutorial' }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
