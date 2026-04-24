import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RangeSlider } from './RangeSlider';

describe('RangeSlider', () => {
  it('renders label and display value', () => {
    render(<RangeSlider label="Volume" value={0.5} min={0} max={1} step={0.1} displayValue="50%" onChange={() => {}} />);
    expect(screen.getByText('Volume')).toBeInTheDocument();
    expect(screen.getByText('50%')).toBeInTheDocument();
  });

  it('renders input with correct min/max/step/value', () => {
    render(<RangeSlider label="Speed" value={1.2} min={0.5} max={2} step={0.1} displayValue="1.2x" onChange={() => {}} />);
    const input = screen.getByRole('slider');
    expect(input).toHaveAttribute('min', '0.5');
    expect(input).toHaveAttribute('max', '2');
    expect(input).toHaveAttribute('step', '0.1');
    expect(input).toHaveAttribute('value', '1.2');
  });

  it('calls onChange with parsed float when slider changes', () => {
    const onChange = vi.fn();
    render(<RangeSlider label="Pitch" value={1} min={0.5} max={1.5} step={0.05} displayValue="1.00" onChange={onChange} />);
    const input = screen.getByRole('slider');
    fireEvent.change(input, { target: { value: '1.05' } });
    expect(onChange).toHaveBeenCalledWith(1.05);
  });
});
