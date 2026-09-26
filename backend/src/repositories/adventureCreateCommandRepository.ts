import { getDb } from '../persistence/database.js';

export type CreateCommandPhase = 'reserved' | 'session_created' | 'party_ready' | 'started';

export type CreateCommandRow = {
  owner_key: string;
  request_id: string;
  payload_hash: string;
  namespace_id: string;
  session_id: string;
  operation_id: string | null;
  phase: CreateCommandPhase;
  created_at: number;
  updated_at: number;
};

export const adventureCreateCommandRepository = {
  get(ownerKey: string, requestId: string): CreateCommandRow | null {
    return (getDb().prepare('SELECT * FROM adventure_create_commands WHERE owner_key = ? AND request_id = ?').get(ownerKey, requestId) as CreateCommandRow | undefined) ?? null;
  },

  // Returns false when the key already exists (a concurrent or earlier request owns it).
  reserve(row: Omit<CreateCommandRow, 'operation_id' | 'phase' | 'updated_at'>): boolean {
    const result = getDb().prepare(`
      INSERT OR IGNORE INTO adventure_create_commands (owner_key, request_id, payload_hash, namespace_id, session_id, operation_id, phase, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, NULL, 'reserved', ?, ?)
    `).run(row.owner_key, row.request_id, row.payload_hash, row.namespace_id, row.session_id, row.created_at, row.created_at);
    return result.changes > 0;
  },

  setPhase(ownerKey: string, requestId: string, phase: CreateCommandPhase, operationId: string | null, now: number): void {
    getDb().prepare('UPDATE adventure_create_commands SET phase = ?, operation_id = COALESCE(?, operation_id), updated_at = ? WHERE owner_key = ? AND request_id = ?')
      .run(phase, operationId, now, ownerKey, requestId);
  },
};
