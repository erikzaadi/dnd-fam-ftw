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

  static async generateCampaignBrief(sessionId: string, worldDescription: string | undefined, useLocalAI: boolean, displayName?: string): Promise<string | null> {
    try {
      const nameContext = displayName?.trim() ? `\n\nRealm name: "${displayName.trim()}"` : '';
      const descContext = worldDescription?.trim()
        ? `\n\nRealm description: "${worldDescription.trim()}"`
        : '';
      const prompt = `/no_think Generate a compact DM campaign brief (3-5 sentences) for a family fantasy adventure.${nameContext}${descContext}
Include:
1. An overarching quest or threat (the final goal the party will face)
2. Three escalating stages: early discovery, a dangerous mid-game challenge, and a climactic confrontation
3. One or two recurring elements (a villain, a magical item, a landmark) woven across all stages
Be specific and imaginative. This will guide the AI Dungeon Master to give players a sense of forward progress.`;

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
      max_tokens: 150,
    }, { signal: AbortSignal.timeout(20_000) });
    const msg = response.choices[0].message;
    const raw = msg.content || (msg as unknown as Record<string, string>)['reasoning_content'] || '';
    return raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  }
}
