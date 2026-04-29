import { EventEmitter } from 'events';
import type { Request, Response } from 'express';

const eventEmitter = new EventEmitter();

const writeEvent = (res: Response, data: Record<string, unknown>) => {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
};

const setSseHeaders = (res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
};

export const registerSessionEventStream = (req: Request, res: Response, sessionId: string) => {
  setSseHeaders(res);

  const onUpdate = (data: Record<string, unknown>) => {
    if (data.sessionId === sessionId) {
      writeEvent(res, data);
    }
  };

  eventEmitter.on('update', onUpdate);
  req.on('close', () => {
    eventEmitter.off('update', onUpdate);
  });
};

export const registerSessionListEventStream = (req: Request, res: Response, namespaceId: string) => {
  setSseHeaders(res);
  writeEvent(res, { type: 'connected' });

  const onUpdate = (data: Record<string, unknown>) => {
    if (data.namespaceId === namespaceId) {
      writeEvent(res, data);
    }
  };

  eventEmitter.on('session-list-update', onUpdate);
  req.on('close', () => {
    eventEmitter.off('session-list-update', onUpdate);
  });
};

export const broadcastUpdate = (sessionId: string, type: string, payload: Record<string, unknown>) => {
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
