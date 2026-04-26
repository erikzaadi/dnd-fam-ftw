import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChronicleDrawer } from './ChronicleDrawer';
import type { TurnResult } from '../../types';
import type { TtsSettings } from '../../tts/ttsTypes';

vi.mock('../../lib/api', () => ({
  imgSrc: (url: string | null | undefined) => url ?? '',
}));
vi.mock('./StatIcon', () => ({ StatImg: () => null }));
vi.mock('./D20', () => ({ D20: () => null }));
vi.mock('./RollBreakdown', () => ({ RollBreakdown: () => null }));
vi.mock('../../lib/game', () => ({ beatTarget: () => '10' }));

const makeTurn = (id: number): TurnResult => ({
  id,
  narration: `Turn ${id} narration`,
  choices: [],
  imagePrompt: null,
  imageSuggested: false,
  turnType: 'normal',
});

const HISTORY = [makeTurn(1), makeTurn(2), makeTurn(3)];
const TTS_SETTINGS: TtsSettings = {
  enabled: false,
  autoSpeakNarration: false,
  rate: 1,
  pitch: 1,
  volume: 1,
  preferredVoiceURI: null,
  preferredVoiceName: null,
  preferredLang: null,
  preferredStyle: 'neutral',
  preferredGenderHint: 'any',
};

const renderDrawer = (viewedTurnIdx: number, onSelectTurn = vi.fn(), onClose = vi.fn()) =>
  render(
    <ChronicleDrawer
      history={HISTORY}
      party={[]}
      onClose={onClose}
      onSelectTurn={onSelectTurn}
      viewedTurnIdx={viewedTurnIdx}
      ttsSettings={TTS_SETTINGS}
    />
  );

describe('ChronicleDrawer keyboard navigation', () => {
  it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn();
    renderDrawer(1, vi.fn(), onClose);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onSelectTurn with previous index on ArrowLeft', () => {
    const onSelectTurn = vi.fn();
    renderDrawer(2, onSelectTurn);
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(onSelectTurn).toHaveBeenCalledWith(1);
  });

  it('calls onSelectTurn with next index on ArrowRight', () => {
    const onSelectTurn = vi.fn();
    renderDrawer(1, onSelectTurn);
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(onSelectTurn).toHaveBeenCalledWith(2);
  });

  it('does not go below 0 on ArrowLeft at first turn', () => {
    const onSelectTurn = vi.fn();
    renderDrawer(0, onSelectTurn);
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(onSelectTurn).toHaveBeenCalledWith(0);
  });

  it('does not exceed history length on ArrowRight at last turn', () => {
    const onSelectTurn = vi.fn();
    renderDrawer(2, onSelectTurn);
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(onSelectTurn).toHaveBeenCalledWith(2);
  });

  it('renders turn narration rows', () => {
    renderDrawer(0);
    expect(screen.getByText('Turn 1 narration')).toBeInTheDocument();
    expect(screen.getByText('Turn 2 narration')).toBeInTheDocument();
    expect(screen.getByText('Turn 3 narration')).toBeInTheDocument();
  });
});
