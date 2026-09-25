import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { RealmOriginStoryService } from '../../services/realmOriginStoryService.js';
import { StateService } from '../../services/stateService.js';
import { cleanupIntegrationEnvironment, insertSessionState, makeTestSession, setupIntegrationEnvironment, type IntegrationTestPaths } from './testSessionFixtures.js';

const { create } = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock('../../providers/ai/AiProviderFactory.js', () => ({
  createChatClientForTier: vi.fn(() => ({ client: { chat: { completions: { create } } }, model: 'mock-async' })),
  createNarrationProvider: vi.fn(),
}));

let paths: IntegrationTestPaths;

beforeAll(() => {
  paths = setupIntegrationEnvironment('origin-story');
});

beforeEach(() => {
  create.mockReset();
  let call = 0;
  // Each model call tells a different story, like the real thing.
  create.mockImplementation(async () => {
    call += 1;
    await new Promise(resolve => setTimeout(resolve, 20));
    return { choices: [{ message: { content: `Story number ${call}.` } }] };
  });
});

afterAll(() => {
  cleanupIntegrationEnvironment(paths);
});

describe('RealmOriginStoryService.generate', () => {
  it('gives concurrent requests one story from one model call', async () => {
    await insertSessionState(makeTestSession({ id: 'origin-concurrent' }));

    const stories = await Promise.all([
      RealmOriginStoryService.generate('origin-concurrent'),
      RealmOriginStoryService.generate('origin-concurrent'),
      RealmOriginStoryService.generate('origin-concurrent'),
    ]);

    expect(create).toHaveBeenCalledTimes(1);
    expect(new Set(stories).size).toBe(1);
    expect((await StateService.getSession('origin-concurrent'))?.originStory).toBe(stories[0]);
  });

  it('never replaces a stored story', async () => {
    await insertSessionState(makeTestSession({ id: 'origin-stored' }));
    const first = await RealmOriginStoryService.generate('origin-stored');

    expect(await RealmOriginStoryService.generate('origin-stored')).toBe(first);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('keeps the story another process stored first', async () => {
    await insertSessionState(makeTestSession({ id: 'origin-race' }));
    create.mockImplementationOnce(async () => {
      // Another server process finishes first while this call is still generating.
      StateService.setOriginStoryIfMissing('origin-race', 'The other story.', new Date().toISOString());
      return { choices: [{ message: { content: 'This story.' } }] };
    });

    expect(await RealmOriginStoryService.generate('origin-race')).toBe('The other story.');
    expect((await StateService.getSession('origin-race'))?.originStory).toBe('The other story.');
  });
});
