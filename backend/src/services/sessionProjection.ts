import type { Session, SessionState } from '../types.js';

// Private DM material that must never reach play views (session GET, SSE payloads).
// The DM-facing session list and edit dialog read DM Prep through their own endpoints.
const PRIVATE_SESSION_FIELDS = [
  'dmPrep',
  'compiledDmPrep',
  'dmPrepEncounters',
  'dmPrepImageBrief',
  'adventurePlan',
] as const;

export const toPublicSession = <T extends Session | SessionState>(session: T): Session => {
  const copy: Record<string, unknown> = { ...session };
  for (const field of PRIVATE_SESSION_FIELDS) {
    delete copy[field];
  }
  return copy as unknown as Session;
};
