import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { OnboardingOverlay } from './OnboardingOverlay';

describe('OnboardingOverlay', () => {
  it('renders nothing when step is null', () => {
    const { container } = render(<OnboardingOverlay step={null} onAdvance={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when step is 4 (silent wait)', () => {
    const { container } = render(<OnboardingOverlay step={4} onAdvance={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing for unknown step values', () => {
    const { container } = render(<OnboardingOverlay step={99} onAdvance={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders step 1 anchored to story box', () => {
    render(<OnboardingOverlay step={1} onAdvance={vi.fn()} />);
    expect(screen.getByText('The Story Box')).toBeInTheDocument();
    expect(screen.getByText(/full screen/)).toBeInTheDocument();
  });

  it('renders step 2 anchored to party box', () => {
    render(<OnboardingOverlay step={2} onAdvance={vi.fn()} />);
    expect(screen.getByText('The Party Box')).toBeInTheDocument();
    expect(screen.getByText(/HP and stats/)).toBeInTheDocument();
  });

  it('renders step 3 as dismissible action dock callout', () => {
    const onAdvance = vi.fn();
    render(<OnboardingOverlay step={3} onAdvance={onAdvance} />);
    expect(screen.getByText('Your turn')).toBeInTheDocument();
    expect(screen.getByText(/Unleash/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(onAdvance).toHaveBeenCalledOnce();
  });

  it('keeps the step 3 callout shell non-blocking', () => {
    render(<OnboardingOverlay step={3} onAdvance={vi.fn()} />);
    expect(screen.getByText('Your turn')).toBeInTheDocument();
    expect(screen.getByText(/Unleash/)).toBeInTheDocument();
    expect(screen.getByText('Your turn').closest('.pointer-events-none')).toBeInTheDocument();
  });

  it('renders step 5 with roll explanation', () => {
    render(<OnboardingOverlay step={5} onAdvance={vi.fn()} />);
    expect(screen.getByText('That was the roll')).toBeInTheDocument();
    expect(screen.getByText(/d20 is rolled/)).toBeInTheDocument();
  });

  it('renders step 6 with controls content', () => {
    render(<OnboardingOverlay step={6} onAdvance={vi.fn()} />);
    expect(screen.getByText('Controls at the top')).toBeInTheDocument();
    expect(screen.getByText(/gear icon/)).toBeInTheDocument();
  });

  it('renders step 7 with chronicle and TTS content', () => {
    render(<OnboardingOverlay step={7} onAdvance={vi.fn()} />);
    expect(screen.getByText('The Chronicle')).toBeInTheDocument();
    expect(screen.getByText(/read narration aloud/)).toBeInTheDocument();
  });

  it('calls onAdvance when a CTA button is clicked', () => {
    const onAdvance = vi.fn();
    render(<OnboardingOverlay step={1} onAdvance={onAdvance} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onAdvance).toHaveBeenCalledOnce();
  });

  it('shows Let\'s go! on step 7', () => {
    render(<OnboardingOverlay step={7} onAdvance={vi.fn()} />);
    expect(screen.getByRole('button').textContent).toContain("Let's go");
  });
});
