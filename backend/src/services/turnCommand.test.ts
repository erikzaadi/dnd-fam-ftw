import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { operationRepository } from '../repositories/operationRepository.js';
import { cleanupIntegrationEnvironment, insertSessionState, makeTestSession, setupIntegrationEnvironment, type IntegrationTestPaths } from '../tests/integration/testSessionFixtures.js';
import type { SessionState } from '../types.js';
import { validateTurnActionRequest } from './turnActionInput.js';
import { submitTurnCommand, type TurnCommand } from './turnCommand.js';
import { runAcceptedTurnAction } from './turnSubmissionService.js';

// The turn command through its interface: a temp database for acceptance, the runner
// and validation replaced.

vi.mock('./turnSubmissionService.js', () => ({ runAcceptedTurnAction: vi.fn() }));
vi.mock('./turnActionInput.js', async importOriginal => ({
  ...await importOriginal<typeof import('./turnActionInput.js')>(),
  validateTurnActionRequest: vi.fn(() => null),
}));

let paths: IntegrationTestPaths;
let seq = 0;

const newSession = async (): Promise<SessionState> => {
  const session = makeTestSession({ id: `command-${++seq}` });
  await insertSessionState(session);
  return { ...session, revision: 0 };
};

const commandFor = (session: SessionState, overrides: Partial<TurnCommand<string, string>> = {}): TurnCommand<string, string> => ({
  adventureId: session.id,
  realmId: 'local',
  requestId: `command-request-${seq}`,
  idempotencyPayload: { action: 'Pip sneaks' },
  expectedRevision: 0,
  session,
  prepareNewWork: vi.fn(() => ({ ok: true as const, request: { action: 'Pip sneaks', statUsed: 'mischief' } })),
  admit: vi.fn(() => ({ ok: true as const })),
  ...overrides,
});

beforeAll(() => {
  paths = setupIntegrationEnvironment('turn-command');
});

beforeEach(() => {
  vi.mocked(runAcceptedTurnAction).mockClear();
  vi.mocked(validateTurnActionRequest).mockReset().mockReturnValue(null);
});

afterAll(() => {
  cleanupIntegrationEnvironment(paths);
});

describe('submitTurnCommand', () => {
  it('accepts new work once and starts the runner with the prepared request', async () => {
    const session = await newSession();
    const command = commandFor(session);

    const result = await submitTurnCommand(command);

    expect(result.type).toBe('accepted');
    expect(runAcceptedTurnAction).toHaveBeenCalledTimes(1);
    expect(vi.mocked(runAcceptedTurnAction).mock.calls[0].slice(1)).toEqual([session.id, 'local', { action: 'Pip sneaks', statUsed: 'mischief' }]);
  });

  it('replays a known request before preparing, waiting or admitting', async () => {
    const session = await newSession();
    const first = await submitTurnCommand(commandFor(session));
    const beforeAdmit = vi.fn(async () => 'continue' as const);
    const retry = commandFor(session, { beforeAdmit, expectedRevision: 7 });

    const result = await submitTurnCommand(retry);

    expect(result.type).toBe('replay');
    expect(result.type === 'replay' && first.type === 'accepted' && result.operation.id === first.operation.id).toBe(true);
    expect(retry.prepareNewWork).not.toHaveBeenCalled();
    expect(beforeAdmit).not.toHaveBeenCalled();
    expect(retry.admit).not.toHaveBeenCalled();
    expect(runAcceptedTurnAction).toHaveBeenCalledTimes(1);
  });

  it('stops at each step in order and accepts nothing', async () => {
    const session = await newSession();

    const notReady = commandFor(session, { prepareNewWork: () => ({ ok: false, reason: 'stale_preview' }) });
    expect(await submitTurnCommand(notReady)).toEqual({ type: 'not_ready', reason: 'stale_preview' });
    expect(notReady.admit).not.toHaveBeenCalled();

    vi.mocked(validateTurnActionRequest).mockReturnValueOnce({ ok: false, status: 400, body: { error: 'invalid_action' } });
    const invalid = commandFor(session);
    expect(await submitTurnCommand(invalid)).toMatchObject({ type: 'invalid', rejection: { status: 400 } });
    expect(invalid.admit).not.toHaveBeenCalled();

    const cancelled = commandFor(session, { beforeAdmit: async () => 'cancelled' });
    expect(await submitTurnCommand(cancelled)).toEqual({ type: 'cancelled' });
    expect(cancelled.admit).not.toHaveBeenCalled();

    const refused = commandFor(session, { admit: () => ({ ok: false, refusal: 'limit_reached' }) });
    expect(await submitTurnCommand(refused)).toEqual({ type: 'refused', refusal: 'limit_reached' });

    expect(operationRepository.getByRequestId(session.id, `command-request-${seq}`)).toBeNull();
    expect(runAcceptedTurnAction).not.toHaveBeenCalled();
  });

  it('refuses a stale expected revision at acceptance, after admission', async () => {
    const session = await newSession();
    const command = commandFor(session, { expectedRevision: 3 });

    expect(await submitTurnCommand(command)).toMatchObject({ type: 'conflict', code: 'stale_revision' });
    expect(command.admit).toHaveBeenCalledTimes(1);
    expect(runAcceptedTurnAction).not.toHaveBeenCalled();
  });
});
