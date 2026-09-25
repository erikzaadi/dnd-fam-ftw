import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session, TurnResult } from '../types';
import { useAutoIdeas } from './useAutoIdeas';

const mocks = vi.hoisted(() => ({ fetchIdeas: vi.fn() }));

vi.mock('../lib/ideas', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/ideas')>(),
  fetchIdeas: mocks.fetchIdeas,
}));

const PAYLOAD = { turnId: 7, revision: 3, characterId: 'hero', degraded: false, choices: [] };
const session = (overrides: Partial<Session> = {}): Session => ({
  id: 's1',
  scene: 'Hall',
  turn: 3,
  revision: 3,
  party: [],
  activeCharacterId: 'hero',
  displayName: 'Realm',
  savingsMode: false,
  interventionState: { rescuesUsed: 0 },
  autoIdeas: true,
  ...overrides,
});
const turn = (overrides: Partial<TurnResult> = {}): TurnResult => ({ id: 7, narration: 'A hall.', choices: [], imagePrompt: null, imageSuggested: false, ideasRevision: 3, ideasCharacterId: 'hero', ...overrides });

const run = (props: Partial<Parameters<typeof useAutoIdeas>[0]> = {}) => {
  const onIdeas = vi.fn();
  const hook = renderHook((p: Parameters<typeof useAutoIdeas>[0]) => useAutoIdeas(p), {
    initialProps: { sessionId: 's1', session: session(), latestTurn: turn(), busy: false, onIdeas, ...props },
  });
  return { ...hook, onIdeas };
};

describe('useAutoIdeas', () => {
  beforeEach(() => {
    mocks.fetchIdeas.mockReset();
    mocks.fetchIdeas.mockResolvedValue({ kind: 'ideas', payload: PAYLOAD });
  });

  it('asks once for a new turn without ideas and hands them over', async () => {
    const { onIdeas, rerender } = run();

    await waitFor(() => expect(onIdeas).toHaveBeenCalledWith(PAYLOAD));
    expect(mocks.fetchIdeas).toHaveBeenCalledWith('s1', { turnId: 7, revision: 3 });

    rerender({ sessionId: 's1', session: session(), latestTurn: turn(), busy: false, onIdeas });
    expect(mocks.fetchIdeas).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the setting is off, a turn is resolving, or ideas are already there', () => {
    run({ session: session({ autoIdeas: false }) });
    run({ busy: true });
    run({ latestTurn: turn({ choices: [{ id: 1, label: 'Sneak', stat: 'mischief', difficulty: 'normal' }] }) });
    run({ session: session({ gameOver: true }) });
    expect(mocks.fetchIdeas).not.toHaveBeenCalled();
  });

  it('asks again for the next turn', async () => {
    const { onIdeas, rerender } = run();
    await waitFor(() => expect(mocks.fetchIdeas).toHaveBeenCalledTimes(1));

    rerender({ sessionId: 's1', session: session({ revision: 4 }), latestTurn: turn({ id: 8, ideasRevision: 4 }), busy: false, onIdeas });
    await waitFor(() => expect(mocks.fetchIdeas).toHaveBeenCalledTimes(2));
    expect(mocks.fetchIdeas).toHaveBeenLastCalledWith('s1', { turnId: 8, revision: 4 });
  });
});
