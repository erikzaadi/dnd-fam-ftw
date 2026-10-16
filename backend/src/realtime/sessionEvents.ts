import { EventEmitter } from 'events';
import type { Request, Response } from 'express';
import { devLog } from '../lib/devLog.js';
import { toPublicSession, toPublicTurn } from '../services/sessionProjection.js';
import type { Session, TurnResult } from '../types.js';

const eventEmitter = new EventEmitter();
const HEARTBEAT_INTERVAL_MS = 25000;

const writeEvent = (res: Response, data: Record<string, unknown>) => {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
};

const setSseHeaders = (res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
};

// Access is checked when a stream connects and again on every heartbeat, so a removed
// member or revoked TV loses the stream within one interval. Not per event: narration
// chunks are too frequent for a database lookup each.
const openStream = (
  req: Request,
  res: Response,
  channel: 'update' | 'session-list-update',
  matches: (data: Record<string, unknown>) => boolean,
  stillAllowed: () => boolean,
) => {
  setSseHeaders(res);
  writeEvent(res, { type: 'connected' });

  const onUpdate = (data: Record<string, unknown>) => {
    if (matches(data)) {
      writeEvent(res, data);
    }
  };
  let closed = false;
  const close = () => {
    if (closed) {
      return;
    }
    closed = true;
    clearInterval(heartbeat);
    eventEmitter.off(channel, onUpdate);
    res.end();
  };
  const heartbeat = setInterval(() => {
    if (!stillAllowed()) {
      close();
      return;
    }
    writeEvent(res, { type: 'heartbeat' });
  }, HEARTBEAT_INTERVAL_MS);

  eventEmitter.on(channel, onUpdate);
  req.on('close', close);
};

export const registerSessionEventStream = (req: Request, res: Response, sessionId: string, stillAllowed: () => boolean) => {
  openStream(req, res, 'update', data => data.sessionId === sessionId, stillAllowed);
};

export const registerSessionListEventStream = (req: Request, res: Response, namespaceId: string, stillAllowed: () => boolean) => {
  openStream(req, res, 'session-list-update', data => data.namespaceId === namespaceId, stillAllowed);
};

export const broadcastUpdate = (sessionId: string, type: string, payload: Record<string, unknown>) => {
  if (type !== 'narration_chunk') {
    devLog.log(`[Broadcast] ${type} session=${sessionId}`);
  }
  // Every session and turn object sent to viewers goes through the public projection.
  const safePayload: Record<string, unknown> = { ...payload };
  if (payload.session && typeof payload.session === 'object') {
    safePayload.session = toPublicSession(payload.session as Session);
  }
  if (payload.turnResult && typeof payload.turnResult === 'object') {
    safePayload.turnResult = toPublicTurn(payload.turnResult as TurnResult);
  }
  eventEmitter.emit('update', { sessionId, type, ...safePayload });
};

// Settings or lifecycle changed outside a turn. Views apply the patch and discard
// previews computed against an older revision.
export const broadcastSessionUpdated = (sessionId: string, revision: number, changes: Record<string, unknown>) => {
  broadcastUpdate(sessionId, 'session_updated', { revision, changes });
};

export const broadcastSessionListUpdate = (namespaceId: string | undefined, type: string, payload: Record<string, unknown>) => {
  if (!namespaceId) {
    return;
  }
  eventEmitter.emit('session-list-update', { namespaceId, type, ...payload });
};

export const broadcastSessionChanged = (namespaceId: string | undefined, sessionId: string, action: 'created' | 'updated' | 'deleted') => {
  broadcastSessionListUpdate(namespaceId, 'session_changed', { sessionId, action });
};

export const broadcastInstantStartReady = (namespaceId: string | undefined, sessionId: string) => {
  broadcastSessionListUpdate(namespaceId, 'instant_start_ready', { sessionId });
};
