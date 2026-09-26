import os from 'os';
import path from 'path';
import fs from 'fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { adventureCreateCommandRepository } from '../repositories/adventureCreateCommandRepository.js';
import { operationRepository } from '../repositories/operationRepository.js';
import { runInstantStartBackground } from './instantStartService.js';
import { generateAndCommitInitialTurn } from './initialTurnService.js';
import { buildDescribedHero, createAdventure, retryOpening } from './adventureCreationService.js';
import { StateService } from './stateService.js';

vi.mock('./sessionNameService.js', () => ({ generateSessionDisplayName: vi.fn(async () => 'Troll Bridge') }));
vi.mock('./instantStartService.js', async importOriginal => ({
  ...await importOriginal<typeof import('./instantStartService.js')>(),
  runInstantStartBackground: vi.fn(async () => undefined),
}));
vi.mock('./initialTurnService.js', () => ({ generateAndCommitInitialTurn: vi.fn(async () => null) }));

const DB_PATH = path.join(os.tmpdir(), `dnd-adventure-create-test-${Date.now()}.sqlite`);
const NAMESPACE = 'ns-create';
const admit = vi.fn(() => ({ ok: true as const }));

let seq = 0;
const nextRequestId = () => `create-request-${++seq}`;

const create = (requestId: string, overrides: Partial<Parameters<typeof createAdventure>[0]['input']> = {}) => createAdventure({
  ownerKey: 'user:u1',
  namespaceId: NAMESPACE,
  requestId,
  input: { premise: 'A silly forest with a grumpy troll', heroes: 'auto', partySize: 2, format: 'one_evening', ...overrides },
  admit,
});

beforeAll(() => {
  process.env.SQLITE_DB_PATH = DB_PATH;
  process.env.IMAGE_STORAGE_PROVIDER = 'local';
  StateService.initialize();
});

beforeEach(() => {
  vi.mocked(runInstantStartBackground).mockClear();
  vi.mocked(generateAndCommitInitialTurn).mockClear();
  admit.mockClear();
});

afterAll(() => {
  fs.rmSync(DB_PATH, { force: true });
});

describe('createAdventure', () => {
  it('creates a text-only one-evening adventure with a party and a start operation', async () => {
    const result = await create(nextRequestId());
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const session = await StateService.getSession(result.sessionId);
    expect(session).toMatchObject({ displayName: 'Troll Bridge', savingsMode: true, worldDescription: 'A silly forest with a grumpy troll' });
    expect(session?.adventure?.format).toBe('one_evening');
    expect(session?.party).toHaveLength(2);
    expect(session?.activeCharacterId).toBe(session?.party[0].id);
    expect(result.operation).toMatchObject({ kind: 'start', status: 'accepted' });
    expect(runInstantStartBackground).toHaveBeenCalledTimes(1);
    expect(admit).toHaveBeenCalledTimes(1);
  });

  it('returns the same adventure for a retried request, without new work or budget', async () => {
    const requestId = nextRequestId();
    const first = await create(requestId);
    const second = await create(requestId);
    expect(second).toMatchObject({ ok: true, replayed: true });
    expect(first.ok && second.ok && second.sessionId === first.sessionId).toBe(true);
    expect(runInstantStartBackground).toHaveBeenCalledTimes(1);
    expect(admit).toHaveBeenCalledTimes(1);
  });

  it('creates one adventure for concurrent duplicates', async () => {
    const requestId = nextRequestId();
    const results = await Promise.all(Array.from({ length: 10 }, () => create(requestId)));
    const ids = new Set(results.map(result => (result.ok ? result.sessionId : result.error)));
    expect(ids.size).toBe(1);
    expect(runInstantStartBackground).toHaveBeenCalledTimes(1);
  });

  it('refuses a reused request id with a different premise', async () => {
    const requestId = nextRequestId();
    await create(requestId);
    expect(await create(requestId, { premise: 'Something else entirely' })).toMatchObject({ ok: false, error: 'request_id_conflict' });
  });

  it('does not start paid work when admission refuses', async () => {
    admit.mockReturnValueOnce({ ok: false, code: 'limit_reached', message: 'Spent' } as never);
    expect(await create(nextRequestId())).toMatchObject({ ok: false, error: 'limit_reached' });
    expect(runInstantStartBackground).not.toHaveBeenCalled();
  });

  it('resumes a command interrupted after the party was saved', async () => {
    const requestId = nextRequestId();
    const created = await StateService.createSession('Half made', 'normal', true, NAMESPACE, 'balanced', undefined, 'Half Made', `half-${seq}`);
    created.party = [buildDescribedHero({ name: 'Zara', class: 'Rogue', species: 'Elf' }, created.id)];
    created.activeCharacterId = created.party[0].id;
    await StateService.updateSession(created.id, created);
    const input = { premise: 'Half made', heroes: 'auto' as const, partySize: 2, format: 'one_evening' as const };
    // Recorded as the service would have before the crash.
    const { hashOperationPayload } = await import('./sessionOperationService.js');
    adventureCreateCommandRepository.reserve({ owner_key: 'user:u1', request_id: requestId, payload_hash: hashOperationPayload({ namespaceId: NAMESPACE, input }), namespace_id: NAMESPACE, session_id: created.id, created_at: Date.now() });
    adventureCreateCommandRepository.setPhase('user:u1', requestId, 'party_ready', null, Date.now());

    const result = await create(requestId, input);
    expect(result).toMatchObject({ ok: true, sessionId: created.id, replayed: true });
    expect((await StateService.getSession(created.id))?.party.map(hero => hero.name)).toEqual(['Zara']);
    expect(runInstantStartBackground).toHaveBeenCalledTimes(1);
    expect(admit).not.toHaveBeenCalled();
  });

  it('reports an interrupted opening instead of re-running it', async () => {
    const requestId = nextRequestId();
    const first = await create(requestId);
    if (!first.ok || !first.operation) {
      throw new Error('expected a start operation');
    }
    operationRepository.failInterrupted();
    vi.mocked(runInstantStartBackground).mockClear();
    const replay = await create(requestId);
    expect(replay).toMatchObject({ ok: true, operation: { id: first.operation.id, status: 'failed', errorCode: 'interrupted' } });
    expect(runInstantStartBackground).not.toHaveBeenCalled();

    const retried = await retryOpening(first.sessionId, NAMESPACE, 'retry-opening-1');
    expect(retried).toMatchObject({ ok: true, operation: { kind: 'start', status: 'accepted' } });
    expect(await retryOpening(first.sessionId, NAMESPACE, 'retry-opening-1')).toMatchObject({ ok: true, replayed: true });
  });
});

describe('buildDescribedHero', () => {
  it('derives stats and hit points from the class, never from the caller', () => {
    const wizard = buildDescribedHero({ name: 'Mo', class: 'Wizard', species: 'Owl' }, 's');
    expect(wizard.stats).toEqual({ might: 1, magic: 5, mischief: 1 });
    const knight = buildDescribedHero({ name: 'Sir B', class: 'Brave knight', species: 'Human' }, 's');
    expect(knight.class).toBe('Brave knight');
    expect(knight.stats.might).toBeGreaterThanOrEqual(4);
    const unknown = buildDescribedHero({ name: 'Q', class: 'Baker', species: 'Human' }, 's');
    expect(unknown.stats.might + unknown.stats.magic + unknown.stats.mischief).toBe(7);
    expect(unknown.max_hp).toBe(10);
  });
});
