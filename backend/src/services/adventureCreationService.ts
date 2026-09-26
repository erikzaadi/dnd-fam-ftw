import { createId } from '../lib/ids.js';
import { findArchetypeByClass } from '../data/instantStartArchetypes.js';
import { broadcastSessionChanged } from '../realtime/sessionEvents.js';
import { adventureCreateCommandRepository, type CreateCommandRow } from '../repositories/adventureCreateCommandRepository.js';
import { operationRepository, toPublicOperation } from '../repositories/operationRepository.js';
import type { AdventureFormat, Character, SessionOperation } from '../types.js';
import { ImageService } from './imageService.js';
import { buildInstantStartParty, runInstantStartBackground } from './instantStartService.js';
import { acceptSessionOperation, hashOperationPayload, runSessionOperation } from './sessionOperationService.js';
import { generateAndCommitInitialTurn } from './initialTurnService.js';
import { runBackground } from '../middleware/runBackground.js';
import { generateSessionDisplayName } from './sessionNameService.js';
import { StateService } from './stateService.js';
import { getEffectiveLimits } from './usageLimitService.js';

// Durable adventure creation for clients without the website's setup screens (MCP
// create_adventure). The command is recorded before any generation and advances through
// phases, so a retry, a concurrent duplicate, or a restart resumes the same session
// instead of creating another one. Paid work that may have run before a crash (the
// opening turn) is never re-run automatically: the failed start operation is reported
// and a deliberate retry_opening request starts it again.

export type HeroDescription = { name: string; class: string; species: string; quirk?: string };

export type CreateAdventureInput = {
  premise: string;
  heroes: 'auto' | HeroDescription[];
  // Auto party only: how many heroes (default 3).
  partySize?: number;
  format: AdventureFormat;
  // off (default): no pictures at all. on_demand: only scenes a player asks for.
  images?: 'off' | 'on_demand';
};

export type CreateAdventureResult =
  | { ok: true; sessionId: string; operation: SessionOperation | null; replayed: boolean }
  | { ok: false; status: number; error: string; message: string };

const DEFAULT_AUTO_PARTY_SIZE = 3;
// Every hero has 7 stat points, each stat 1-5 (same as the character form).
const BALANCED_STATS = { might: 2, magic: 2, mischief: 3 };

const fail = (status: number, error: string, message: string): CreateAdventureResult => ({ ok: false, status, error, message });

// Server-derived hero: stats and HP come from the class archetype, never from the caller.
export const buildDescribedHero = (hero: HeroDescription, sessionId: string): Character => {
  const archetype = findArchetypeByClass(hero.class);
  const maxHp = archetype?.maxHp ?? 10;
  return {
    id: createId(),
    name: hero.name.trim(),
    class: hero.class.trim(),
    species: hero.species.trim(),
    quirk: hero.quirk?.trim() ?? '',
    hp: maxHp,
    max_hp: maxHp,
    status: 'active',
    stats: { ...(archetype?.stats ?? BALANCED_STATS) },
    inventory: [],
    avatarUrl: ImageService.generateInitialsSvg(hero.name.trim(), sessionId),
    avatarPrompt: '',
    avatarStorageKey: '',
    avatarStorageProvider: 'local',
  };
};

const buildParty = (input: CreateAdventureInput, sessionId: string): Character[] => {
  if (input.heroes === 'auto') {
    const size = input.partySize ?? DEFAULT_AUTO_PARTY_SIZE;
    let party = buildInstantStartParty(sessionId);
    while (party.length < size) {
      party = [...party, ...buildInstantStartParty(sessionId)].filter((hero, index, all) => all.findIndex(other => other.name === hero.name) === index);
    }
    return party.slice(0, size);
  }
  return input.heroes.map(hero => buildDescribedHero(hero, sessionId));
};

const operationFor = (command: CreateCommandRow): SessionOperation | null =>
  command.operation_id ? toPublicOperation(operationRepository.get(command.session_id, command.operation_id)) : null;

// One in-flight resume per command, so concurrent duplicates wait for the same work.
const inFlight = new Map<string, Promise<CreateAdventureResult>>();

const advance = async (command: CreateCommandRow, input: CreateAdventureInput, replayed: boolean): Promise<CreateAdventureResult> => {
  const { owner_key: ownerKey, request_id: requestId, session_id: sessionId, namespace_id: namespaceId } = command;
  let phase = command.phase;
  let session = await StateService.getSession(sessionId);

  if (phase === 'reserved') {
    if (!session) {
      const displayName = await generateSessionDisplayName(input.premise);
      // The image policy is set at creation, before any side effect can ask for art.
      // Neither off nor on_demand ever generates pictures by itself.
      session = await StateService.createSession(input.premise, 'normal', true, namespaceId, 'balanced', undefined, displayName, sessionId, input.format, input.images ?? 'off');
      broadcastSessionChanged(namespaceId, sessionId, 'created');
    }
    phase = 'session_created';
    adventureCreateCommandRepository.setPhase(ownerKey, requestId, phase, null, Date.now());
  }
  if (!session) {
    return fail(410, 'adventure_deleted', 'This adventure was deleted after it was created. Start a new one with a new requestId.');
  }

  if (phase === 'session_created') {
    if (session.party.length === 0) {
      session.party = buildParty(input, sessionId);
      session.activeCharacterId = session.party[0].id;
      await StateService.updateSession(sessionId, session);
    }
    phase = 'party_ready';
    adventureCreateCommandRepository.setPhase(ownerKey, requestId, phase, null, Date.now());
  }

  if (phase === 'party_ready') {
    const acceptance = acceptSessionOperation({
      sessionId,
      namespaceId,
      kind: 'start',
      requestId: `create:${requestId}`,
      payload: { kind: 'start' },
    });
    if (acceptance.type === 'missing') {
      return fail(410, 'adventure_deleted', 'This adventure was deleted after it was created. Start a new one with a new requestId.');
    }
    if (acceptance.type === 'conflict') {
      return fail(409, acceptance.code, acceptance.message);
    }
    adventureCreateCommandRepository.setPhase(ownerKey, requestId, 'started', acceptance.operation.id, Date.now());
    if (acceptance.type === 'accepted') {
      broadcastSessionChanged(namespaceId, sessionId, 'updated');
      void runInstantStartBackground(sessionId, session, namespaceId, { displayName: session.displayName, worldDescription: input.premise }, acceptance.operation);
    }
    return { ok: true, sessionId, operation: toPublicOperation(acceptance.operation), replayed };
  }

  return { ok: true, sessionId, operation: operationFor(command), replayed };
};

export const createAdventure = async (params: {
  ownerKey: string;
  namespaceId: string;
  requestId: string;
  input: CreateAdventureInput;
  // Budget admission, called only when this request creates something new.
  admit: () => { ok: true } | { ok: false; code: string; message: string };
  now?: number;
}): Promise<CreateAdventureResult> => {
  const { ownerKey, namespaceId, requestId, input } = params;
  const key = `${ownerKey}:${requestId}`;
  const pending = inFlight.get(key);
  if (pending) {
    return pending;
  }
  const payloadHash = hashOperationPayload({ namespaceId, input });
  const run = async (): Promise<CreateAdventureResult> => {
    const existing = adventureCreateCommandRepository.get(ownerKey, requestId);
    if (existing) {
      if (existing.payload_hash !== payloadHash) {
        return fail(409, 'request_id_conflict', 'This requestId was already used to create a different adventure. Use a new requestId.');
      }
      return advance(existing, input, true);
    }
    const limits = getEffectiveLimits(namespaceId);
    if (limits.maxSessions !== null && StateService.countSessionsInNamespace(namespaceId) >= limits.maxSessions) {
      return fail(403, 'session_limit', `This realm has reached its limit of ${limits.maxSessions} adventure(s). Delete an old one on the website to start a new one.`);
    }
    const admission = params.admit();
    if (!admission.ok) {
      return fail(429, admission.code, admission.message);
    }
    const now = params.now ?? Date.now();
    const reserved = adventureCreateCommandRepository.reserve({
      owner_key: ownerKey,
      request_id: requestId,
      payload_hash: payloadHash,
      namespace_id: namespaceId,
      session_id: createId(),
      created_at: now,
    });
    const command = adventureCreateCommandRepository.get(ownerKey, requestId);
    if (!command) {
      return fail(500, 'create_failed', 'Could not record the new adventure. Try again with the same requestId.');
    }
    return advance(command, input, !reserved);
  };
  const promise = run().finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
};

// Deliberate retry of an opening that never committed (for example after a restart).
// Only for a session with no turns and no operation in progress.
export const retryOpening = async (sessionId: string, namespaceId: string, requestId: string): Promise<CreateAdventureResult> => {
  const session = await StateService.getSession(sessionId);
  if (!session) {
    return fail(404, 'not_found', 'Adventure not found.');
  }
  const known = operationRepository.getByRequestId(sessionId, requestId);
  if (known) {
    return { ok: true, sessionId, operation: toPublicOperation(known), replayed: true };
  }
  if ((await StateService.getTurnHistory(sessionId)).length > 0) {
    return fail(409, 'already_started', 'This adventure already has its opening scene. Read it with get_adventure.');
  }
  if (session.party.length === 0) {
    return fail(409, 'no_party', 'This adventure has no heroes yet. Finish setting it up on the website.');
  }
  const acceptance = acceptSessionOperation({ sessionId, namespaceId, kind: 'start', requestId, payload: { kind: 'start' } });
  if (acceptance.type === 'missing') {
    return fail(404, 'not_found', 'Adventure not found.');
  }
  if (acceptance.type === 'conflict') {
    return fail(409, acceptance.code, acceptance.message);
  }
  if (acceptance.type === 'accepted') {
    // The campaign brief from the first attempt is kept; only the opening is retried.
    const operation = acceptance.operation;
    runBackground(`retry-opening session=${sessionId} operation=${operation.id}`, () => runSessionOperation(operation, async () => {
      const result = await generateAndCommitInitialTurn({ sessionId, operationId: operation.id });
      if (!result) {
        return { error: 'not_found', message: 'Adventure not found.' };
      }
    }));
  }
  return { ok: true, sessionId, operation: toPublicOperation(acceptance.operation), replayed: acceptance.type === 'replay' };
};
