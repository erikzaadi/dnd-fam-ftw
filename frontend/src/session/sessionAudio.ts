import type { Session, TurnResult } from '../types';
import { audioManager } from '../audio/audioManager';

// Presentation policy for background music tension. Views decide when to apply it;
// the SSE transport (useSessionEvents) only delivers events.
export const applySessionTension = (session: Session | null | undefined, turnResult?: TurnResult | null): void => {
  if (session?.encounterState?.status === 'active') {
    audioManager.setTension('high');
    return;
  }
  if (turnResult?.turnType === 'conclusion') {
    audioManager.setTension('low');
    return;
  }
  if (turnResult?.currentTensionLevel) {
    audioManager.setTension(turnResult.currentTensionLevel);
  }
};

// Dice sound, then the outcome sting once the dice settle.
export const playRollSfx = (roll: { roll: number; success: boolean }): void => {
  audioManager.playSfx('dice-roll');
  setTimeout(() => {
    if (roll.roll === 20) {
      audioManager.playSfx('roll-20');
    } else if (roll.success) {
      audioManager.playSfx('success-roll');
    } else {
      audioManager.playSfx('failed-roll');
    }
  }, 600);
};
