import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PageLoader } from './PageLoader';

describe('PageLoader', () => {
  it('renders loading text', () => {
    render(<PageLoader />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('has full-screen dark background', () => {
    render(<PageLoader />);
    const el = screen.getByText('Loading...');
    expect(el.className).toContain('min-h-screen');
    expect(el.className).toContain('bg-slate-950');
  });
});
