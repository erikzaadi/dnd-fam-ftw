import type { SessionPreview } from '../types';

export function getSessionEntryPath(session: Pick<SessionPreview, 'id' | 'party'>): string {
  if (session.party.length === 0) {
    return `/session/${session.id}/assembly`;
  }
  return `/session/${session.id}/recap`;
}
