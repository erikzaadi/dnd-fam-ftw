import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConfirmDialog } from './ConfirmDialog';

const renderDialog = (opts: { onConfirm?: () => void; onCancel?: () => void; confirmLabel?: string } = {}) =>
  render(
    <ConfirmDialog
      message="Are you sure?"
      onConfirm={opts.onConfirm ?? vi.fn()}
      onCancel={opts.onCancel ?? vi.fn()}
      confirmLabel={opts.confirmLabel}
    />
  );

describe('ConfirmDialog', () => {
  it('renders the message', () => {
    renderDialog();
    expect(screen.getByText('Are you sure?')).toBeInTheDocument();
  });

  it('uses default confirmLabel "Confirm" when not specified', () => {
    renderDialog();
    expect(screen.getByText('Confirm')).toBeInTheDocument();
  });

  it('uses custom confirmLabel when provided', () => {
    renderDialog({ confirmLabel: 'Delete' });
    expect(screen.getByText('Delete')).toBeInTheDocument();
  });

  it('Cancel button is focused by default', () => {
    renderDialog();
    expect(document.activeElement).toBe(screen.getByText('Cancel'));
  });

  it('calls onConfirm when confirm button is clicked', () => {
    const onConfirm = vi.fn();
    renderDialog({ onConfirm });
    fireEvent.click(screen.getByText('Confirm'));
    expect(onConfirm).toHaveBeenCalled();
  });

  it('calls onCancel when cancel button is clicked', () => {
    const onCancel = vi.fn();
    renderDialog({ onCancel });
    fireEvent.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalled();
  });

  it('calls onCancel when Escape is pressed', () => {
    const onCancel = vi.fn();
    renderDialog({ onCancel });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalled();
  });

  it('ArrowRight moves focus from Cancel to Confirm', () => {
    renderDialog();
    const cancel = screen.getByText('Cancel');
    const confirm = screen.getByText('Confirm');
    cancel.focus();
    const container = cancel.closest('div')!;
    fireEvent.keyDown(container, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(confirm);
  });

  it('ArrowLeft moves focus from Confirm to Cancel', () => {
    renderDialog();
    const cancel = screen.getByText('Cancel');
    const confirm = screen.getByText('Confirm');
    confirm.focus();
    const container = cancel.closest('div')!;
    fireEvent.keyDown(container, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(cancel);
  });

  it('vim l moves focus from Cancel to Confirm', () => {
    renderDialog();
    const cancel = screen.getByText('Cancel');
    const confirm = screen.getByText('Confirm');
    cancel.focus();
    const container = cancel.closest('div')!;
    fireEvent.keyDown(container, { key: 'l' });
    expect(document.activeElement).toBe(confirm);
  });

  it('vim h moves focus from Confirm to Cancel', () => {
    renderDialog();
    const cancel = screen.getByText('Cancel');
    const confirm = screen.getByText('Confirm');
    confirm.focus();
    const container = cancel.closest('div')!;
    fireEvent.keyDown(container, { key: 'h' });
    expect(document.activeElement).toBe(cancel);
  });
});
