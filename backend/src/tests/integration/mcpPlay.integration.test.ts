import type { Server } from 'http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createImageProvider } from '../../providers/ai/AiProviderFactory.js';
import { operationRepository } from '../../repositories/operationRepository.js';
import { sessionRepository } from '../../repositories/sessionRepository.js';
import { acceptSessionOperation } from '../../services/sessionOperationService.js';
import { StateService } from '../../services/stateService.js';
import { resetMcpRateLimits } from '../../mcp/auth.js';
import { clearPreviewDedupForTests } from '../../mcp/previewDedup.js';
import { createPilot, insertSession, makeCallTool, setMcpTestEnv, startMcpServer } from '../../mcp/testHarness.js';
import { pinTurnStrategy, resetMockNarrationProvider } from './mockNarrationProvider.js';
import { cleanupIntegrationEnvironment, setupIntegrationEnvironment, type IntegrationTestPaths } from './testSessionFixtures.js';

// Full MCP play against the real services: create -> opening -> preview -> confirm ->
// result, with narration mocked, every other model call failing fast, and an image
// provider that must never be reached (text-only invariant).

vi.mock('../../providers/ai/AiProviderFactory.js', async () => {
  const { createMockNarrationProvider } = await import('./mockNarrationProvider.js');
  const failingClient = { chat: { completions: { create: vi.fn(async () => {
    throw new Error('no model in tests'); 
  }) } } };
  return {
    createNarrationProvider: vi.fn(() => createMockNarrationProvider()),
    createChatClientForTier: vi.fn(() => ({ client: failingClient, model: 'test-model' })),
    createImageProvider: vi.fn(() => {
      throw new Error('image provider must not be used by a text-only adventure'); 
    }),
  };
});

vi.mock('../../services/statSuggestionService.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../services/statSuggestionService.js')>(),
  previewFreeAction: vi.fn(async () => ({ stat: 'mischief', interpretedAction: 'Distract the troll with a silly dance' })),
}));

pinTurnStrategy('parallel');

const SENTINEL = 'SENTINEL_SECRET_DM_PREP';

let paths: IntegrationTestPaths;
let server: Server;
let callTool: ReturnType<typeof makeCallTool>;
let player: ReturnType<typeof createPilot>;
let outsider: ReturnType<typeof createPilot>;

type Structured = Record<string, unknown>;
const structured = <T = Structured>(response: Awaited<ReturnType<typeof callTool>>): T => {
  if (response.body?.result?.isError) {
    throw new Error(`tool error: ${response.body.result.content?.[0]?.text}`);
  }
  return response.body?.result?.structuredContent as T;
};
const errorText = (response: Awaited<ReturnType<typeof callTool>>) => response.body?.result?.content?.[0]?.text ?? '';

const waitForOperation = async (adventureId: string, operationId: string) => {
  for (let attempt = 0; attempt < 10; attempt++) {
    const view = structured<{ done: boolean; operation: { status: string }; turns: { narration: string }[] }>(
      await callTool(player.secret, 'get_operation', { adventureId, operationId, waitSeconds: 5 }));
    if (view.done) {
      return view;
    }
  }
  throw new Error('operation did not finish');
};

beforeAll(() => {
  setMcpTestEnv();
  paths = setupIntegrationEnvironment('mcp-play');
  player = createPilot('mcp-player@example.com');
  outsider = createPilot('mcp-outsider@example.com');
  const started = startMcpServer();
  server = started.server;
  callTool = makeCallTool(started.baseUrl);
});

beforeEach(() => {
  resetMockNarrationProvider();
  resetMcpRateLimits();
  clearPreviewDedupForTests();
});

afterAll(() => {
  server?.close();
  cleanupIntegrationEnvironment(paths);
});

describe('MCP play end to end', () => {
  it('creates a text-only adventure and plays a confirmed turn without any image call', async () => {
    const created = structured<{ adventureId: string; operation: { id: string } }>(await callTool(player.secret, 'create_adventure', {
      premise: 'A silly forest where a troll guards a bridge',
      heroes: 'auto',
      partySize: 2,
      requestId: 'create-e2e-0001',
    }));
    const opening = await waitForOperation(created.adventureId, created.operation.id);
    expect(opening.operation.status).toBe('completed');
    expect(opening.turns).toHaveLength(1);

    // The opening carries the origin story (the fallback here, since models fail in
    // tests) and the party, as the website's origin view shows them first.
    const openingRead = await callTool(player.secret, 'get_operation', { adventureId: created.adventureId, operationId: created.operation.id, waitSeconds: 0 });
    const openingView = structured<{ opening: { originStory: string | null; party: { name: string; quirk: string }[] } | null }>(openingRead);
    expect(openingView.opening?.party).toHaveLength(2);
    expect(openingView.opening?.originStory).toMatch(/came together/);
    expect(openingRead.body?.result?.content?.[0]?.text).toMatch(/Origin story/);

    // A lost create response resolves to the same adventure.
    const replay = structured<{ adventureId: string; replayed: boolean }>(await callTool(player.secret, 'create_adventure', {
      premise: 'A silly forest where a troll guards a bridge', heroes: 'auto', partySize: 2, requestId: 'create-e2e-0001',
    }));
    expect(replay).toMatchObject({ adventureId: created.adventureId, replayed: true });
    expect(StateService.countSessionsInNamespace(player.namespaceId)).toBe(1);

    const adventure = structured<{ revision: number; party: unknown[]; history: unknown[] }>(
      await callTool(player.secret, 'get_adventure', { adventureId: created.adventureId }));
    expect(adventure.party).toHaveLength(2);
    expect(adventure.history).toHaveLength(1);

    const preview = structured<{ previewId: string; revision: number }>(await callTool(player.secret, 'preview_action', {
      adventureId: created.adventureId, expectedRevision: adventure.revision, action: 'I distract the troll with a dance',
    }));
    const confirmed = structured<{ operation: { id: string } }>(await callTool(player.secret, 'confirm_action', {
      adventureId: created.adventureId, previewId: preview.previewId, expectedRevision: adventure.revision, requestId: 'confirm-e2e-0001',
    }));
    const result = await waitForOperation(created.adventureId, confirmed.operation.id);
    expect(result.operation.status).toBe('completed');
    expect(result.turns.length).toBeGreaterThanOrEqual(1);

    // Website handoff: the same history is what the browser reads.
    expect(await StateService.getTurnHistory(created.adventureId)).toHaveLength(1 + result.turns.length);

    // The spent preview cannot be confirmed again, even with a new request id.
    const again = await callTool(player.secret, 'confirm_action', {
      adventureId: created.adventureId, previewId: preview.previewId, expectedRevision: adventure.revision, requestId: 'confirm-e2e-0002',
    });
    expect(errorText(again)).toMatch(/stale_revision|stale_preview/);

    expect(createImageProvider).not.toHaveBeenCalled();
  });

  it('lets only one of a browser action and an MCP confirmation proceed', async () => {
    insertSession('race-session', player.namespaceId, 'Race Bridge');
    const preview = structured<{ previewId: string }>(await callTool(player.secret, 'preview_action', {
      adventureId: 'race-session', expectedRevision: 0, action: 'I distract the troll with a dance',
    }));
    // The website accepts an action first.
    const web = acceptSessionOperation({ sessionId: 'race-session', namespaceId: player.namespaceId, kind: 'action', requestId: 'web-request-1', expectedRevision: 0, payload: { action: 'web' } });
    expect(web.type).toBe('accepted');
    const mcp = await callTool(player.secret, 'confirm_action', { adventureId: 'race-session', previewId: preview.previewId, expectedRevision: 0, requestId: 'mcp-race-0001' });
    expect(errorText(mcp)).toContain('operation_in_progress');
    expect(operationRepository.getByRequestId('race-session', 'mcp-race-0001')).toBeNull();
  });

  it('never shows another realm\'s adventure or private DM material', async () => {
    insertSession('secret-session', player.namespaceId, 'Secret Bridge', SENTINEL);
    sessionRepository.patchSessionSync('secret-session', { dmPrep: SENTINEL });
    const own = await callTool(player.secret, 'get_adventure', { adventureId: 'secret-session' });
    expect(own.text).not.toContain(SENTINEL);
    const listed = await callTool(player.secret, 'list_adventures', { limit: 25 });
    expect(listed.text).not.toContain(SENTINEL);

    const foreign = await callTool(outsider.secret, 'get_adventure', { adventureId: 'secret-session' });
    expect(foreign.body?.result?.isError).toBe(true);
    expect(foreign.text).not.toContain('Secret Bridge');
    const foreignPreview = await callTool(outsider.secret, 'preview_action', { adventureId: 'secret-session', expectedRevision: 0, action: 'peek' });
    expect(foreignPreview.body?.result?.isError).toBe(true);
    expect(structured<{ adventures: unknown[] }>(await callTool(outsider.secret, 'list_adventures', {})).adventures).toHaveLength(0);
  });

  it('refuses to start another adventure over the realm limit, without orphans', async () => {
    const { namespaceRepository } = await import('../../repositories/namespaceRepository.js');
    const limited = createPilot('mcp-limited@example.com');
    namespaceRepository.setNamespaceLimits(limited.namespaceId, 0, null);
    const res = await callTool(limited.secret, 'create_adventure', { premise: 'Too many', requestId: 'create-limit-0001' });
    expect(errorText(res)).toContain('session_limit');
    expect(StateService.countSessionsInNamespace(limited.namespaceId)).toBe(0);
  });
});
