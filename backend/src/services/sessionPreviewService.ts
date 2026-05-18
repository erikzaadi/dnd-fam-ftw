import { ImageService } from './imageService.js';
import { StateService } from './stateService.js';
import { StorySummaryService } from './storySummaryService.js';
import { broadcastSessionListUpdate, broadcastUpdate } from '../realtime/sessionEvents.js';
import { runBackground } from '../middleware/runBackground.js';

export const triggerPreviewRegen = (sessionId: string, namespaceId?: string) => {
  runBackground(`preview-regen session=${sessionId}`, async () => {
    const session = await StateService.getSession(sessionId);
    if (!session) {
      console.warn(`[Preview] Skipping generation for missing session ${sessionId}`);
      return;
    }
    if (session.savingsMode) {
      console.log(`[Preview] Skipping generation for ${sessionId}; savings mode is enabled`);
      return;
    }
    console.log(`[Preview] Generating preview for ${sessionId}`);
    const result = await ImageService.generateSessionPreview(session);
    if (result) {
      StateService.updateSessionPreviewImage(sessionId, result.url);
      const eventNamespaceId = namespaceId ?? StateService.getSessionNamespaceId(sessionId);
      broadcastUpdate(sessionId, 'image_ready', { target: 'session_preview', imageUrl: result.url });
      broadcastSessionListUpdate(eventNamespaceId, 'preview_image_available', { sessionId, previewImageUrl: result.url });
      console.log(`[Preview] Updated preview for ${sessionId}: ${result.url}`);
    }
  });
};

export const refreshDmPrepImageBriefAndPreview = (
  sessionId: string,
  dmPrep: string | null | undefined,
  namespaceId?: string,
) => {
  runBackground(`dm-prep-brief session=${sessionId}`, async () => {
    try {
      const brief = await StorySummaryService.generateDmPrepImageBrief(dmPrep);
      await StateService.patchSession(sessionId, { dmPrepImageBrief: brief });
    } catch (err) {
      console.warn('[Preview] DM prep visual brief refresh failed:', err);
    }
    triggerPreviewRegen(sessionId, namespaceId);
  });
};
