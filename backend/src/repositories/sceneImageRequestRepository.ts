import { getDb } from '../persistence/database.js';

export type SceneImageRequestStatus = 'pending' | 'done' | 'failed';

export type SceneImageRequestRow = {
  session_id: string;
  turn_id: number;
  request_id: string;
  status: SceneImageRequestStatus;
  created_at: number;
  updated_at: number;
};

export const sceneImageRequestRepository = {
  get(sessionId: string, turnId: number): SceneImageRequestRow | null {
    return (getDb().prepare('SELECT * FROM scene_image_requests WHERE session_id = ? AND turn_id = ?').get(sessionId, turnId) as SceneImageRequestRow | undefined) ?? null;
  },

  // Starts (or deliberately restarts) the one request for this turn.
  start(sessionId: string, turnId: number, requestId: string, now: number): void {
    getDb().prepare(`
      INSERT INTO scene_image_requests (session_id, turn_id, request_id, status, created_at, updated_at) VALUES (?, ?, ?, 'pending', ?, ?)
      ON CONFLICT (session_id, turn_id) DO UPDATE SET request_id = excluded.request_id, status = 'pending', created_at = excluded.created_at, updated_at = excluded.updated_at
    `).run(sessionId, turnId, requestId, now, now);
  },

  finish(sessionId: string, turnId: number, requestId: string, status: 'done' | 'failed', now: number): void {
    getDb().prepare('UPDATE scene_image_requests SET status = ?, updated_at = ? WHERE session_id = ? AND turn_id = ? AND request_id = ?')
      .run(status, now, sessionId, turnId, requestId);
  },
};
