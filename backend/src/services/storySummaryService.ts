import { createChatClientForTier } from '../providers/ai/AiProviderFactory.js';
import { runBackground } from '../middleware/runBackground.js';
import { StateService } from './stateService.js';
import { ImageService } from './imageService.js';
import type { EncounterSeed } from '../types.js';

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

const ENCOUNTER_SEEDS_MARKER = 'ENCOUNTER_SEEDS:';

type GenerateCampaignBriefOptions = {
  mediaMode?: 'background' | 'inline';
  onMediaReady?: () => void | Promise<void>;
};

const tryParseJsonArray = (text: string): EncounterSeed[] | null => {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = fenceMatch ? fenceMatch[1].trim() : text.trim();
  try {
    const parsed = JSON.parse(jsonStr) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return null;
    }
    return parsed as EncounterSeed[];
  } catch {
    return null;
  }
};

export const parseEncounterSeeds = (raw: string): { brief: string; seeds: EncounterSeed[] | null } => {
  const markerIdx = raw.indexOf(ENCOUNTER_SEEDS_MARKER);
  if (markerIdx === -1) {
    const candidate = raw.trim();
    // Fallback A: entire response is a bare or fenced JSON array
    if (candidate.startsWith('[') || candidate.startsWith('```')) {
      const seeds = tryParseJsonArray(candidate);
      if (seeds) {
        return { brief: '', seeds };
      }
    }
    // Fallback B: prose + trailing fenced JSON block (AI omitted the ENCOUNTER_SEEDS: marker)
    const lastFenceIdx = candidate.lastIndexOf('```');
    const firstFenceIdx = candidate.indexOf('```');
    if (firstFenceIdx !== -1 && lastFenceIdx !== firstFenceIdx) {
      const fenceBlock = candidate.slice(firstFenceIdx);
      const seeds = tryParseJsonArray(fenceBlock);
      if (seeds) {
        return { brief: candidate.slice(0, firstFenceIdx).trim(), seeds };
      }
    }
    return { brief: candidate, seeds: null };
  }
  const brief = raw.slice(0, markerIdx).trim();
  const jsonRaw = raw.slice(markerIdx + ENCOUNTER_SEEDS_MARKER.length).trim();
  const seeds = tryParseJsonArray(jsonRaw);
  return { brief, seeds };
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

  static async generateCampaignBrief(
    sessionId: string,
    worldDescription: string | undefined,
    displayName?: string,
    difficulty?: string,
    gameMode?: string,
    options: GenerateCampaignBriefOptions = {},
  ): Promise<string | null> {
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

      const prompt = `Generate a structured DM campaign brief for a family fantasy adventure.${nameContext}${descContext}${difficultyNote}${gameModeNote}

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

Be specific: invent names, places, visual details, clues, and recurring motifs. This guides the AI Dungeon Master turn by turn. Keep it playful, adventurous, and safe for a family table.

After the prose sections above, append one machine-readable block:
ENCOUNTER_SEEDS:
A JSON array covering ALL encounters across EVERY stage of the campaign (Early, Mid, and Climax). Include at least one seed per stage. Seeds represent any situation where the party faces something they must fight, disable, bypass, outwit, or negotiate with - including combat enemies, exploration hazards with entity-like threats (creatures, constructs, phantoms, traps with guardians), and climax confrontations. Pure puzzle or social scenes with no opposing entity may be omitted. The climax confrontation MUST always be included. Aim for 3-5 seeds total. Each entry must follow this schema exactly:
{
  "name": "string - short encounter name like Thornwood Guardian",
  "triggerHint": "string - when this encounter fires, e.g. when party enters the Thornwood or approaches the vault",
  "enemies": [
    {
      "name": "string",
      "role": "minion|standard|elite|boss|hazard",
      "weaknesses": [{ "label": "free-form player-facing weakness label, e.g. 'mirror flash', 'old oath', 'cracked moonstone', 'rusted hinge', 'thornwood sap'", "school": "the constrained magic/mechanical category that exploits this weakness: fire|frost|light|shadow|nature|storm|mind|force|holy|mechanical|null" }],
      "traits": ["string"]
    }
  ],
  "areas": [{ "label": "string", "tags": ["string"], "effect": "optional 1-sentence quirky or dangerous area effect, e.g. 'slippery ice floor', 'arcane surge zone', 'crumbling ledge'. Omit if none." }],
  "objective": "string - optional combat objective beyond simple defeat",
  "lootHint": "string - one thematic item the party earns from this encounter. Must be a specific named object (e.g. 'tideborn shard', 'sealed crest letter', 'cursed recipe scroll') - never a generic phrase and never a name that echoes the encounter name or enemy names. Omit if no fitting item exists."
}
The JSON block must be a valid JSON array with no extra text or prose inside it. Omit keys with null or empty values.`;

      const raw = await this.callSummarize(prompt, 2000, 50_000, `campaign brief session=${sessionId}`);
      if (raw) {
        const { brief, seeds } = parseEncounterSeeds(raw);
        await StateService.patchSession(sessionId, { dmPrep: brief });
        const generateMedia = async () => {
          const [imageBrief, seededWithMedia] = await Promise.all([
            this.generateDmPrepImageBrief(brief, sessionId),
            this.generateSeedMedia(seeds, sessionId),
          ]);
          await StateService.patchSession(sessionId, { dmPrepImageBrief: imageBrief, dmPrepEncounters: seededWithMedia });
          if (seededWithMedia) {
            console.log(`[Campaign] ${seededWithMedia.length} encounter seed(s) stored for session ${sessionId}`);
          }
          await options.onMediaReady?.();
        };
        if (options.mediaMode === 'inline') {
          await generateMedia();
        } else {
          console.log(`[Campaign] Brief ready for session ${sessionId} — media generating in background`);
          runBackground(`campaign-media session=${sessionId}`, generateMedia);
        }
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

  static async generateSeedMedia(seeds: EncounterSeed[] | null, sessionId: string): Promise<EncounterSeed[] | null> {
    if (!seeds?.length) {
      return seeds;
    }
    const session = await StateService.getSession(sessionId);
    if (session?.savingsMode) {
      return seeds;
    }
    const updated = await Promise.all(seeds.map(async seed => {
      const [enemies, areas] = await Promise.all([
        Promise.all(seed.enemies.map(async enemy => {
          try {
            const result = await ImageService.generateEnemyAvatar(enemy, sessionId);
            return result.url ? { ...enemy, avatarUrl: result.url } : enemy;
          } catch {
            return enemy;
          }
        })),
        Promise.all(seed.areas.map(async area => {
          try {
            const result = await ImageService.generateAreaImage(area, sessionId);
            return result.url ? { ...area, imageUrl: result.url } : area;
          } catch {
            return area;
          }
        })),
      ]);
      return { ...seed, enemies, areas };
    }));
    return updated;
  }

  private static async callSummarize(prompt: string, maxTokens = 900, timeoutMs = 20_000, label = 'summary'): Promise<string> {
    const { client, model } = createChatClientForTier('async');
    const start = Date.now();
    console.log(`[Summary] Starting ${label} model=${model} maxTokens=${maxTokens} timeoutMs=${timeoutMs}`);
    try {
      const response = await client.chat.completions.create({
        model,
        messages: [{ role: 'user', content: prompt }],
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
