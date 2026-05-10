import { createChatClient } from '../providers/ai/AiProviderFactory.js';
import { StateService } from './stateService.js';

const SUMMARY_INTERVAL = 5;

export const buildCampaignStateSummaryPrompt = (previousSummary: string | undefined, recentNarrations: string[]): string => {
  const previous = previousSummary
    ? `Story so far: ${previousSummary}\n\n`
    : '';
  return `${previous}Recent events:\n${recentNarrations.map((n, i) => `${i + 1}. ${n}`).join('\n')}\n\nWrite a concise campaign state summary that helps the next turn move forward. Use this format exactly:
STORY SO FAR: 2-4 factual sentences about key events, discoveries, victories, setbacks, and current location.
CURRENT ARC: Early discovery | Mid escalation | Climax - choose one and add a short reason.
OPEN THREAD: one unresolved clue, threat, NPC, location, item, or promise the party can act on next.
NEXT PROMISED BEAT: one concrete next beat the DM should pay off soon.
RECENTLY RESOLVED: one combat, challenge, clue, or scene that should not be repeated.`;
};

export class StorySummaryService {
  static shouldUpdate(turn: number): boolean {
    return turn > 1 && turn % SUMMARY_INTERVAL === 0;
  }

  static async maybeUpdate(sessionId: string, turn: number): Promise<void> {
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

      const prompt = buildCampaignStateSummaryPrompt(session.storySummary, recentNarrations);

      const summary = await this.callSummarize(prompt);
      if (summary) {
        await StateService.updateStorySummary(sessionId, summary);
        console.log(`[Summary] Updated at turn ${turn} for session ${sessionId}`);
      }
    } catch (err) {
      console.warn('[Summary] maybeUpdate failed:', err);
    }
  }

  static async updateAfterIntervention(sessionId: string, interventionNarration: string): Promise<void> {
    try {
      const session = await StateService.getSession(sessionId);
      if (!session) {
        return;
      }

      const previous = session.storySummary ? `Previous Summary: ${session.storySummary}\n\n` : '';
      const prompt = `${previous}A major turning point occurred: "${interventionNarration}"\n\nWrite a NEW, concise story summary (2-4 sentences). 
CRITICAL: The party has just been rescued or moved to a new location. Explicitly state that they have LEFT the previous scene behind. 
Focus only on the current situation and the essential journey, ignoring defeated or bypassed enemies from the past.`;

      const summary = await this.callSummarize(prompt);
      if (summary) {
        await StateService.updateStorySummary(sessionId, summary);
        console.log(`[Summary] Updated after intervention for session ${sessionId}`);
      }
    } catch (err) {
      console.warn('[Summary] updateAfterIntervention failed:', err);
    }
  }

  static async generateCampaignBrief(sessionId: string, worldDescription: string | undefined, displayName?: string, difficulty?: string, gameMode?: string): Promise<string | null> {
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
PREMISE: (1-2 sentences - the core quest, what is at stake, and why the party matters)
TONE: (family-friendly tone guidance: wonder, danger level, humor style, and one thing to avoid)
VILLAIN: (name + motivation + sympathetic detail + one tell or behaviour the DM can reuse)
RECURRING NPCS: (2 NPCs with names, roles, quirks, and how they can help or complicate things)
FACTIONS: (2 groups with simple goals, one potential ally and one source of trouble)
LOCATIONS: (3 key locations, each with a one-line description, obstacle, and notable NPC or clue)
SETUP/PAYOFF: (2 quest objects, clues, passwords, or tokens the party can find early and use later; name where each is found and what later challenge it helps solve)
SECRETS: (3 hidden truths or reveals to uncover over time)
ENCOUNTERS: (one combat, one exploration challenge, one social challenge, one magical/weird challenge)
TREASURE: (2-3 thematic rewards or items that feel tied to the world)
STAGES: Early - | Mid - | Climax -
DM NOTE: (one pacing rule and one fail-forward rule for this campaign)

Be specific: invent names, places, visual details, clues, and recurring motifs. This guides the AI Dungeon Master turn by turn. Keep it playful, adventurous, and safe for a family table.`;

      const brief = await this.callSummarize(prompt, 900, 90_000, `campaign brief session=${sessionId}`);
      if (brief) {
        const imageBrief = await this.generateDmPrepImageBrief(brief, sessionId);
        await StateService.patchSession(sessionId, { dmPrep: brief, dmPrepImageBrief: imageBrief });
        console.log(`[Campaign] Brief generated for session ${sessionId}`);
        return brief;
      }
      return null;
    } catch (err) {
      console.warn('[Campaign] generateCampaignBrief failed:', err);
      return null;
    }
  }

  static async generateDmPrepImageBrief(dmPrep: string | undefined | null, sessionId?: string): Promise<string | null> {
    if (!dmPrep?.trim()) {
      return null;
    }

    try {
      const prompt = `Summarize this D&D campaign prep into visual-only cues for an image prompt.

Focus only on things that should be visible in a single realm preview image:
- main boss or main threat
- mini-bosses
- recurring NPC archetypes
- iconic story items or artifacts
- signature locations, factions, creatures, colors, silhouettes, and motifs

Omit plot instructions, secrets, pacing notes, mechanics, long lore, and anything not visually renderable.
Avoid wording that implies text, signs, labels, books, maps, scrolls, plaques, inscriptions, runes, glyphs, or symbols.
Return one compact comma-separated phrase, max 45 words.

DM PREP:
${dmPrep}`;

      const label = sessionId ? `DM prep image brief session=${sessionId}` : 'DM prep image brief';
      const brief = await this.callSummarize(prompt, 120, 12_000, label);
      return brief || null;
    } catch (err) {
      console.warn('[Campaign] DM prep image brief generation failed:', err);
      return null;
    }
  }

  private static async callSummarize(prompt: string, maxTokens = 900, timeoutMs = 20_000, label = 'summary'): Promise<string> {
    const { client, model } = createChatClient();
    const start = Date.now();
    console.log(`[Summary] Starting ${label} model=${model} maxTokens=${maxTokens} timeoutMs=${timeoutMs}`);
    try {
      const response = await client.chat.completions.create({
        model,
        messages: [{ role: 'user', content: `/no_think ${prompt}` }],
        max_tokens: maxTokens,
      }, { signal: AbortSignal.timeout(timeoutMs) });
      console.log(`[Summary] Finished ${label} in ${Date.now() - start}ms`);
      const msg = response.choices[0].message;
      const raw = msg.content || (msg as unknown as Record<string, string>)['reasoning_content'] || '';
      return raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    } catch (err) {
      console.warn(`[Summary] Failed ${label} after ${Date.now() - start}ms`, err);
      throw err;
    }
  }
}
