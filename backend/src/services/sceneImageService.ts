import { generateImageBrief } from '../providers/ai/images/imageBriefProvider.js';
import { sceneImageRequestRepository } from '../repositories/sceneImageRequestRepository.js';
import { turnHistoryRepository } from '../repositories/turnHistoryRepository.js';
import type { SessionState, TensionLevel } from '../types.js';
import { ImageService } from './imageService.js';
import { attachTurnImage } from './turnSideEffectService.js';
import { checkPictureBudget, currentPictureBudgetExhausted } from './usageLimitService.js';

// Explicit, on-demand scene pictures ("show me this scene"). Separate from automatic
// turn images: allowed only when the adventure's image policy permits it, bounded by
// the picture budget, one picture per turn, and never started by a missing image alone.

// A pending request older than this is treated as lost (for example a restart).
const PENDING_TIMEOUT_MS = 10 * 60 * 1000;

export type SceneImageStart =
  | { status: 'ready' }
  | { status: 'pending'; done: Promise<boolean> | null }
  | { status: 'error'; code: string; message: string };

const inFlight = new Map<string, Promise<boolean>>();

const paint = async (session: SessionState, turnId: number, requestId: string): Promise<boolean> => {
  const ref = turnHistoryRepository.getTurnImageRef(session.id, turnId);
  if (!ref) {
    return false;
  }
  const activeName = session.party.find(hero => hero.id === session.activeCharacterId)?.name;
  const tension = (ref.tension ?? undefined) as TensionLevel | undefined;
  try {
    const brief = await generateImageBrief(ref.narration, session.worldDescription ?? session.id, activeName, tension) ?? ref.imagePrompt;
    if (!brief) {
      sceneImageRequestRepository.finish(session.id, turnId, requestId, 'failed', Date.now());
      return false;
    }
    const result = await ImageService.generateImage(brief, session.id, turnId, undefined, undefined, {
      worldDescription: session.worldDescription,
      dmPrepImageBrief: session.dmPrepImageBrief,
      party: session.party,
      activeCharacterId: session.activeCharacterId,
      currentTensionLevel: tension,
    });
    if (!result) {
      sceneImageRequestRepository.finish(session.id, turnId, requestId, 'failed', Date.now());
      return false;
    }
    await attachTurnImage(session.id, turnId, result);
    sceneImageRequestRepository.finish(session.id, turnId, requestId, 'done', Date.now());
    return true;
  } catch (err) {
    console.warn(`[SceneImage] Failed session=${session.id} turn=${turnId}: ${err instanceof Error ? err.message : String(err)}`);
    sceneImageRequestRepository.finish(session.id, turnId, requestId, 'failed', Date.now());
    return false;
  }
};

export const requestSceneImage = (params: {
  session: SessionState;
  namespaceId: string;
  turnId: number;
  requestId: string;
  now?: number;
}): SceneImageStart => {
  const { session, namespaceId, turnId, requestId } = params;
  const now = params.now ?? Date.now();
  const ref = turnHistoryRepository.getTurnImageRef(session.id, turnId);
  if (!ref) {
    return { status: 'error', code: 'turn_not_found', message: 'That turn is not part of this adventure.' };
  }
  if (ref.imageUrl) {
    return { status: 'ready' };
  }
  if ((session.imagePolicy ?? 'off') === 'off') {
    return { status: 'error', code: 'images_off', message: 'Pictures are off for this adventure. Ask the player whether to allow pictures on request (manage_adventure set_images on_demand).' };
  }
  const key = `${session.id}:${turnId}`;
  const existing = sceneImageRequestRepository.get(session.id, turnId);
  if (existing?.status === 'pending' && now - existing.created_at < PENDING_TIMEOUT_MS) {
    return { status: 'pending', done: inFlight.get(key) ?? null };
  }
  if (existing && existing.request_id === requestId) {
    // The same request already ran (or was lost in a restart): report it, never re-pay.
    return existing.status === 'failed' || existing.status === 'pending'
      ? { status: 'error', code: 'image_failed', message: 'Painting this scene did not work. Ask the player before trying again with a new requestId.' }
      : { status: 'ready' };
  }
  const budget = checkPictureBudget(namespaceId) ?? (currentPictureBudgetExhausted() ? { message: "The realm's painters are resting until tomorrow." } : null);
  if (budget) {
    return { status: 'error', code: 'picture_limit', message: budget.message };
  }
  sceneImageRequestRepository.start(session.id, turnId, requestId, now);
  const done = paint(session, turnId, requestId).finally(() => inFlight.delete(key));
  inFlight.set(key, done);
  return { status: 'pending', done };
};

// Bytes for an existing scene picture, capped for inline delivery.
export const readSceneImage = async (sessionId: string, turnId: number, maxBytes: number): Promise<
  | { status: 'image'; data: string; mimeType: string }
  | { status: 'none' | 'unavailable' | 'too_large' }
> => {
  const ref = turnHistoryRepository.getTurnImageRef(sessionId, turnId);
  if (!ref?.imageUrl) {
    return { status: 'none' };
  }
  // Images reused from the realm preview have no stored key of their own.
  const stored = ref.storageKey ? await ImageService.readStoredImage(ref.storageKey) : null;
  if (!stored) {
    return { status: 'unavailable' };
  }
  if (stored.body.length > maxBytes) {
    return { status: 'too_large' };
  }
  return { status: 'image', data: stored.body.toString('base64'), mimeType: stored.contentType };
};
