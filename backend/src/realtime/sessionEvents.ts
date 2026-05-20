import { EventEmitter } from 'events';
import type { Request, Response } from 'express';
import { devLog } from '../lib/devLog.js';

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

const startHeartbeat = (res: Response) => setInterval(() => {
  writeEvent(res, { type: 'heartbeat' });
}, HEARTBEAT_INTERVAL_MS);

export const registerSessionEventStream = (req: Request, res: Response, sessionId: string) => {
  setSseHeaders(res);
  writeEvent(res, { type: 'connected' });
  const heartbeat = startHeartbeat(res);

  const onUpdate = (data: Record<string, unknown>) => {
    if (data.sessionId === sessionId) {
      writeEvent(res, data);
    }
  };

  eventEmitter.on('update', onUpdate);
  req.on('close', () => {
    clearInterval(heartbeat);
    eventEmitter.off('update', onUpdate);
  });
};

export const registerSessionListEventStream = (req: Request, res: Response, namespaceId: string) => {
  setSseHeaders(res);
  writeEvent(res, { type: 'connected' });
  const heartbeat = startHeartbeat(res);

  const onUpdate = (data: Record<string, unknown>) => {
    if (data.namespaceId === namespaceId) {
      writeEvent(res, data);
    }
  };

  eventEmitter.on('session-list-update', onUpdate);
  req.on('close', () => {
    clearInterval(heartbeat);
    eventEmitter.off('session-list-update', onUpdate);
  });
};

export const broadcastUpdate = (sessionId: string, type: string, payload: Record<string, unknown>) => {
  if (type !== 'narration_chunk') {
    devLog.log(`[Broadcast] ${type} session=${sessionId}`);
  }
  eventEmitter.emit('update', { sessionId, type, ...payload });
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
