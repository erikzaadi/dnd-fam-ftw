import type { SessionPreview } from '../types';

export function getSessionEntryPath(session: Pick<SessionPreview, 'id' | 'party' | 'gameOver'>): string {
  if (session.party.length === 0) {
    return `/session/${session.id}/assembly`;
  }
  if (session.gameOver) {
    return `/session/${session.id}`;
  }
  return `/session/${session.id}/recap`;
}
