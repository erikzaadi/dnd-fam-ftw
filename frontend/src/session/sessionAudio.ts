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
