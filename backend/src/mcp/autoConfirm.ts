import { autoConfirmRepository } from '../repositories/autoConfirmRepository.js';
import type { McpPrincipal } from '../services/accessTokenService.js';
import type { StoredActionPreview } from '../services/actionPreviewStore.js';
import { principalKey } from './toolSupport.js';

// Whether the host may send this preview after an Undo window instead of asking, like a
// clean typed action on the website. Only for this token's preview with no warnings, no
// gear, and no clarification exchange, and only while the player has not chosen
// "always ask me first" for this adventure. Anything else needs the player's OK.
export const isAutoConfirmEligible = (
  principal: McpPrincipal,
  sessionId: string,
  preview: StoredActionPreview | null,
  hadClarifications: boolean,
): boolean => {
  if (!preview || hadClarifications || (preview.clarifications?.length ?? 0) > 0) {
    return false;
  }
  if (!preview.publicPreview || preview.publicPreview.warnings.length > 0 || preview.publicPreview.itemAction || preview.kind !== 'free_text') {
    return false;
  }
  if (preview.principal !== principalKey(principal) || preview.sessionId !== sessionId) {
    return false;
  }
  return autoConfirmRepository.isEnabled(principal.userId, sessionId);
};
