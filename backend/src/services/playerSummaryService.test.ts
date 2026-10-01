import { describe, expect, it, vi } from 'vitest';
import type { createChatClientForTier } from '../providers/ai/AiProviderFactory.js';
import type { SessionState, TurnResult } from '../types.js';
import { ADVENTURE_SUMMARY_FALLBACK, buildAdventureSummaryPrompt, buildHeroHistoryPrompt, summarizeAdventure, summarizeHeroHistory } from './playerSummaryService.js';

type ChatClient = ReturnType<typeof createChatClientForTier>;

const fakeChat = (create: (...args: unknown[]) => Promise<unknown>): ChatClient =>
  ({ client: { chat: { completions: { create: vi.fn(create) } } }, model: 'test-model' }) as unknown as ChatClient;

const reply = (content: string | null) => async () => ({ choices: [{ message: { content } }] });

const session = {
  displayName: 'Goblin Kitchen',
  worldDescription: 'A noisy kitchen',
  difficulty: 'normal',
  gameMode: 'balanced',
  originStory: 'Pip was hungry.',
  party: [{ name: 'Pip', class: 'Rogue', species: 'Halfling', hp: 0, status: 'downed' }],
  pastEncounters: [{ name: 'Ladle Fight', status: 'won' }],
} as unknown as SessionState;

const turn = (narration: string) => ({ narration }) as TurnResult;

describe('buildAdventureSummaryPrompt', () => {
  it('tells the story so far, with the realm, party, origin and battles', () => {
    expect(buildAdventureSummaryPrompt(session, [turn('Pip stole a pie.'), turn('The cook gave chase.')])).toBe(
      'Realm: Goblin Kitchen. Description: A noisy kitchen. Difficulty: normal. Mode: balanced'
      + '\n\nParty: Pip the Rogue (Halfling - downed).'
      + '\n\nOrigin: Pip was hungry.'
      + '\n\nAdventure so far:\nPip stole a pie. The cook gave chase.\n\nBattles fought: Ladle Fight (won).'
      + '\n\nSummarize this adventure in 3 sentences for the players. Focus on main plot points, character moments, and current situation.',
    );
  });

  it('describes the premise before the first turn', () => {
    expect(buildAdventureSummaryPrompt(session, [])).toContain('The adventure has not yet begun.');
  });
});

describe('summarizeAdventure', () => {
  it('returns the model reply', async () => {
    expect(await summarizeAdventure(session, [], fakeChat(reply('A tale of pies.')))).toBe('A tale of pies.');
  });

  it('falls back to the legendary line on a failure', async () => {
    const chat = fakeChat(async () => {
      throw new Error('boom');
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await summarizeAdventure(session, [], chat)).toBe(ADVENTURE_SUMMARY_FALLBACK);
  });

  it('rethrows a provider 429 for the rate-limit response', async () => {
    const chat = fakeChat(async () => {
      throw Object.assign(new Error('slow down'), { status: 429 });
    });
    await expect(summarizeAdventure(session, [], chat)).rejects.toMatchObject({ status: 429 });
  });
});

describe('summarizeHeroHistory', () => {
  it('summarizes the last ten turns in one sentence', async () => {
    const chat = fakeChat(reply('  Pip was brave.  '));
    const turns = Array.from({ length: 12 }, (_, i) => ({ narration: `t${i}` }));
    expect(await summarizeHeroHistory(turns, 'Goblin Kitchen', chat)).toBe('Pip was brave.');
    const request = (chat.client.chat.completions.create as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as { messages: { content: string }[] };
    expect(request.messages[0].content).toBe(buildHeroHistoryPrompt(turns.slice(-10).map(t => t.narration), 'Goblin Kitchen'));
    expect(request.messages[0].content).toContain('in "Goblin Kitchen": t2 t3');
  });

  it('gives null on a failure', async () => {
    const chat = fakeChat(async () => {
      throw new Error('boom');
    });
    expect(await summarizeHeroHistory([{ narration: 'x' }], undefined, chat)).toBeNull();
  });
});
