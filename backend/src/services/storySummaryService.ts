import { createChatClient } from '../ai/AiProviderFactory.js';
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

      const previous = session.storySummary ? `Story so far: ${session.storySummary}\n\n` : '';
      const prompt = `${previous}A miraculous intervention just occurred: "${interventionNarration}"\n\nUpdate the story summary (2-4 sentences) to include this rescue as established canon.`;

      const summary = await this.callSummarize(prompt, useLocalAI);
      if (summary) {
        await StateService.updateStorySummary(sessionId, summary);
        console.log(`[Summary] Updated after intervention for session ${sessionId}`);
      }
    } catch (err) {
      console.warn('[Summary] updateAfterIntervention failed:', err);
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
