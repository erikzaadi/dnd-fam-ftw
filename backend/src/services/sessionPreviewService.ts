import { ImageService } from './imageService.js';
import { StateService } from './stateService.js';
import { StorySummaryService } from './storySummaryService.js';
import { broadcastSessionListUpdate, broadcastUpdate } from '../realtime/sessionEvents.js';

export const triggerPreviewRegen = (sessionId: string, namespaceId?: string) => {
  StateService.getSession(sessionId).then(session => {
    if (!session) {
      console.warn(`[Preview] Skipping generation for missing session ${sessionId}`);
      return;
    }
    if (session.savingsMode) {
      console.log(`[Preview] Skipping generation for ${sessionId}; savings mode is enabled`);
      return;
    }
    console.log(`[Preview] Generating preview for ${sessionId}`);
    ImageService.generateSessionPreview(session).then(result => {
      if (result) {
        StateService.updateSessionPreviewImage(sessionId, result.url);
        const eventNamespaceId = namespaceId ?? StateService.getSessionNamespaceId(sessionId);
        broadcastUpdate(sessionId, 'preview_image_available', { previewImageUrl: result.url });
        broadcastSessionListUpdate(eventNamespaceId, 'preview_image_available', { sessionId, previewImageUrl: result.url });
        console.log(`[Preview] Updated preview for ${sessionId}: ${result.url}`);
      }
    }).catch(err => console.warn('[Preview] Generation failed:', err));
  }).catch(err => console.warn('[Preview] Session fetch failed:', err));
};

export const refreshDmPrepImageBriefAndPreview = (
  sessionId: string,
  dmPrep: string | null | undefined,
  namespaceId?: string,
) => {
  StorySummaryService.generateDmPrepImageBrief(dmPrep).then(async brief => {
    await StateService.patchSession(sessionId, { dmPrepImageBrief: brief });
    triggerPreviewRegen(sessionId, namespaceId);
  }).catch(err => {
    console.warn('[Preview] DM prep visual brief refresh failed:', err);
    triggerPreviewRegen(sessionId, namespaceId);
  });
};
