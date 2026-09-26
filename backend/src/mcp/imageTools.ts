import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { getConfig } from '../config/env.js';
import { turnHistoryRepository } from '../repositories/turnHistoryRepository.js';
import type { McpPrincipal } from '../services/accessTokenService.js';
import { readSceneImage, requestSceneImage } from '../services/sceneImageService.js';
import { admitPaidCall } from './admission.js';
import { generateSceneImageInput, sceneImageInput } from './schemas.js';
import { audit, hasScope, loadOwnedSession, NOT_FOUND_MESSAGE, ownsAdventure, toolError } from './toolSupport.js';

// Inline image payload cap. Hosts that cannot show images still get a text fallback.
export const MAX_INLINE_IMAGE_BYTES = 1024 * 1024;
const GENERATE_WAIT_MS = 25_000;

// Link to the adventure on the website, where pictures show for signed-in players.
const websiteLink = (sessionId: string): string | null => {
  const { FRONTEND_URL, APP_BASE_PATH } = getConfig();
  return FRONTEND_URL ? `${FRONTEND_URL.replace(/\/$/, '')}${APP_BASE_PATH}session/${encodeURIComponent(sessionId)}` : null;
};

const fallbackText = (sessionId: string, reason: string): string => {
  const link = websiteLink(sessionId);
  return `${reason}${link ? ` The picture can be seen on the website: ${link}` : ''} No picture was shown here.`;
};

const imageResult = async (principal: McpPrincipal, tool: string, startedAt: number, sessionId: string, turnId: number): Promise<CallToolResult> => {
  const image = await readSceneImage(sessionId, turnId, MAX_INLINE_IMAGE_BYTES);
  if (image.status === 'image') {
    audit(principal, tool, startedAt, 'image', sessionId);
    return {
      content: [
        { type: 'image', data: image.data, mimeType: image.mimeType },
        { type: 'text', text: `Scene picture for turn ${turnId}. If you cannot display images, tell the player it is available on the website.` },
      ],
    };
  }
  audit(principal, tool, startedAt, image.status, sessionId);
  const reason = image.status === 'none'
    ? 'This scene has no picture.'
    : image.status === 'too_large'
      ? 'This picture is too large to send here.'
      : 'This picture cannot be sent here.';
  return { content: [{ type: 'text', text: fallbackText(sessionId, reason) }] };
};

export const registerImageTools = (server: McpServer, principal: McpPrincipal): void => {
  server.registerTool('get_scene_image', {
    title: 'Show a scene picture',
    description: 'Return the existing picture of one scene (turn), if it has one, as an image the host can show. Free: never paints a new picture. Use only when the player asks to see a scene.',
    inputSchema: sceneImageInput,
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  }, async ({ adventureId, turnId }) => {
    const startedAt = Date.now();
    if (!hasScope(principal, 'adventures:read')) {
      audit(principal, 'get_scene_image', startedAt, 'forbidden');
      return toolError('This token cannot read adventures.');
    }
    if (!ownsAdventure(principal, adventureId)) {
      audit(principal, 'get_scene_image', startedAt, 'not_found');
      return toolError(NOT_FOUND_MESSAGE);
    }
    return imageResult(principal, 'get_scene_image', startedAt, adventureId, turnId);
  });

  server.registerTool('generate_scene_image', {
    title: 'Paint a scene picture',
    description: 'Paint a picture of one scene that has none, only when the player explicitly asks. Needs the adventure\'s pictures set to on_demand or automatic (ask the player first; change it with manage_adventure set_images). '
      + 'Spends the picture budget. Waits up to 25 seconds; if still painting, call get_scene_image a little later.',
    inputSchema: generateSceneImageInput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ adventureId, turnId, requestId }) => {
    const startedAt = Date.now();
    const tool = 'generate_scene_image';
    if (!hasScope(principal, 'images:generate')) {
      audit(principal, tool, startedAt, 'forbidden');
      return toolError('This token cannot paint pictures. Create a token with "Paint scene pictures when asked" on the Access tokens page.');
    }
    const session = await loadOwnedSession(principal, adventureId);
    if (!session) {
      audit(principal, tool, startedAt, 'not_found');
      return toolError(NOT_FOUND_MESSAGE);
    }
    // An existing picture is just returned: no budget spent.
    if (turnHistoryRepository.getTurnImageRef(adventureId, turnId)?.imageUrl) {
      return imageResult(principal, tool, startedAt, adventureId, turnId);
    }
    const admission = admitPaidCall(principal);
    if (!admission.ok) {
      audit(principal, tool, startedAt, admission.code, adventureId);
      return toolError(admission.message, admission.code);
    }
    const started = requestSceneImage({ session, namespaceId: principal.namespaceId, turnId, requestId });
    if (started.status === 'error') {
      audit(principal, tool, startedAt, started.code, adventureId);
      return toolError(started.message, started.code);
    }
    if (started.status === 'pending') {
      const finished = started.done
        ? await Promise.race([started.done, new Promise<null>(resolve => setTimeout(() => resolve(null), GENERATE_WAIT_MS))])
        : null;
      if (finished === null) {
        audit(principal, tool, startedAt, 'pending', adventureId);
        return { content: [{ type: 'text', text: 'The painters are still at work. Call get_scene_image for this turn in a little while.' }] };
      }
      if (!finished) {
        audit(principal, tool, startedAt, 'image_failed', adventureId);
        return toolError('Painting this scene did not work. The story continues without it.', 'image_failed');
      }
    }
    return imageResult(principal, tool, startedAt, adventureId, turnId);
  });
};
