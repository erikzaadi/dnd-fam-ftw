import { createChatClient } from '../providers/ai/AiProviderFactory.js';
import { StateService } from './stateService.js';

const SUMMARY_INTERVAL = 5;

export class StorySummaryService {
  static shouldUpdate(turn: number): boolean {
    return turn > 1 && turn % SUMMARY_INTERVAL === 0;
  }

  static async maybeUpdate(sessionId: string, turn: number, useLocalAI: boolean): Promise<void> {
    if (!this.shouldUpdate(turn)) {
      return;
    }
    try {
      const [session, history] = await Promise.all([
        StateService.getSession(sessionId),
        StateService.getTurnHistory(sessionId),
      ]);
      if (!session) {
        return;
      }

      const recentNarrations = history.slice(-SUMMARY_INTERVAL).map(h => h.narration);
      if (recentNarrations.length === 0) {
        return;
      }

      const previousSummary = session.storySummary
        ? `Story so far: ${session.storySummary}\n\n`
        : '';
      const prompt = `${previousSummary}Recent events:\n${recentNarrations.map((n, i) => `${i + 1}. ${n}`).join('\n')}\n\nWrite a concise story summary (2-4 sentences, factual, stable) of what has happened in this adventure so far. Focus on key events and discoveries, not drama.`;

      const summary = await this.callSummarize(prompt, useLocalAI);
      if (summary) {
        await StateService.updateStorySummary(sessionId, summary);
        console.log(`[Summary] Updated at turn ${turn} for session ${sessionId}`);
      }
    } catch (err) {
      console.warn('[Summary] maybeUpdate failed:', err);
    }
  }

  static async updateAfterIntervention(sessionId: string, interventionNarration: string, useLocalAI: boolean): Promise<void> {
    try {
      const session = await StateService.getSession(sessionId);
      if (!session) {
        return;
      }

      const previous = session.storySummary ? `Previous Summary: ${session.storySummary}\n\n` : '';
      const prompt = `${previous}A major turning point occurred: "${interventionNarration}"\n\nWrite a NEW, concise story summary (2-4 sentences). 
CRITICAL: The party has just been rescued or moved to a new location. Explicitly state that they have LEFT the previous scene behind. 
Focus only on the current situation and the essential journey, ignoring defeated or bypassed enemies from the past.`;

      const summary = await this.callSummarize(prompt, useLocalAI);
      if (summary) {
        await StateService.updateStorySummary(sessionId, summary);
        console.log(`[Summary] Updated after intervention for session ${sessionId}`);
      }
    } catch (err) {
      console.warn('[Summary] updateAfterIntervention failed:', err);
    }
  }

  static async generateCampaignBrief(sessionId: string, worldDescription: string | undefined, useLocalAI: boolean, displayName?: string, difficulty?: string, gameMode?: string): Promise<string | null> {
    try {
      const nameContext = displayName?.trim() ? `\nRealm name: "${displayName.trim()}"` : '';
      const descContext = worldDescription?.trim() ? `\nRealm description: "${worldDescription.trim()}"` : '';

      const difficultyGuidance: Record<string, string> = {
        easy: 'Stakes are low and forgiving - threats are scary but survivable, setbacks are temporary, and the villain can be reasoned with.',
        normal: 'Balanced stakes - real danger exists but the party has a fair chance if they are clever.',
        hard: 'High stakes and unforgiving - the villain is ruthless, consequences are permanent, and failure has real costs.',
      };
      const gameModeGuidance: Record<string, string> = {
        cinematic: 'Focus on drama, character moments, and narrative twists over combat.',
        balanced: 'Mix of combat, exploration, and social challenges.',
        fast: 'Keep it punchy - short scenes, quick escalation, minimal filler.',
        'zug-ma-geddon': 'Pure combat chaos. Every location is an arena. Every NPC is either an enemy or a meatshield.',
      };
      const difficultyNote = difficulty ? `\nDifficulty: ${difficulty} - ${difficultyGuidance[difficulty] ?? ''}` : '';
      const gameModeNote = gameMode ? `\nGame mode: ${gameMode} - ${gameModeGuidance[gameMode] ?? ''}` : '';

      const prompt = `/no_think Generate a structured DM campaign brief for a family fantasy adventure.${nameContext}${descContext}${difficultyNote}${gameModeNote}

Use this format exactly:
PREMISE: (1-2 sentences - the core threat or quest and what is at stake)
VILLAIN: (name + one sentence on motivation and one tell or behaviour the DM can use)
LOCATIONS: (2-3 key locations, each with a one-line description and a notable NPC or obstacle)
STAGES: Early - | Mid - | Climax -
DM NOTE: (one pitfall to avoid or one rule about pacing)

Be specific: invent names, places, and details. This guides the AI Dungeon Master turn by turn.`;

      const brief = await this.callSummarize(prompt, useLocalAI);
      if (brief) {
        await StateService.patchSession(sessionId, { dmPrep: brief });
        console.log(`[Campaign] Brief generated for session ${sessionId}`);
        return brief;
      }
      return null;
    } catch (err) {
      console.warn('[Campaign] generateCampaignBrief failed:', err);
      return null;
    }
  }

  private static async callSummarize(prompt: string, useLocalAI: boolean): Promise<string> {
    const { client, model } = createChatClient(useLocalAI);
    const response = await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: `/no_think ${prompt}` }],
      max_tokens: 500,
    }, { signal: AbortSignal.timeout(20_000) });
    const msg = response.choices[0].message;
    const raw = msg.content || (msg as unknown as Record<string, string>)['reasoning_content'] || '';
    return raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  }
}
