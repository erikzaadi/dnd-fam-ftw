import { zodResponseFormat } from 'openai/helpers/zod';
import type { NarrationChoice, NarrationInput, NarrationOutput, NarrationStreamCallbacks } from '../providers/ai/narration/NarrationProvider.js';
import { buildNarrationFallback } from '../providers/ai/narration/narrationFallback.js';
import { buildNarrationUserContent } from '../providers/ai/narration/narrationPrompt.js';
import { isTradeTurn } from '../providers/ai/narration/narrationPrompt.js';
import {
  buildNarrationAgentSystemPrompt,
  buildChoicesAgentSystemPrompt,
  buildCombatAgentSystemPrompt,
  buildInventoryAgentSystemPrompt,
  buildRecoveryAgentSystemPrompt,
} from '../providers/ai/narration/agentPrompts.js';
import {
  narrationAgentOutputSchema,
  choicesAgentOutputSchema,
  combatAgentOutputSchema,
  inventoryAgentOutputSchema,
  recoveryAgentOutputSchema,
  type NarrationAgentOutput,
  type ChoicesAgentOutput,
  type CombatAgentOutput,
  type InventoryAgentOutput,
  type RecoveryAgentOutput,
} from '../providers/ai/narration/agentSchemas.js';
import { createOpenAIClient, getModelForTier } from '../providers/ai/openAiClient.js';
import { devLog } from '../lib/devLog.js';

export type AgentDiagnostic = {
  agent: string;
  durationMs: number;
  status: 'ok' | 'timeout' | 'fallback' | 'retry';
};

export type DmTurnOrchestratorResult = NarrationOutput & {
  agentDiagnostics: AgentDiagnostic[];
  choicesFailed: boolean;
};

async function withDeadline<T>(
  name: string,
  fn: (signal: AbortSignal) => Promise<T>,
  fallback: T,
  deadlineMs: number,
  diagnostics: AgentDiagnostic[],
  retryOnce = false,
): Promise<T> {
  const controller = new AbortController();
  const start = Date.now();
  let retried = false;
  let deadlineTimer: ReturnType<typeof setTimeout> | null = null;
  try {
    const result = await Promise.race([
      (async () => {
        try {
          return await fn(controller.signal);
        } catch (err) {
          if (retryOnce && !controller.signal.aborted) {
            const msg = err instanceof Error ? err.message : '';
            if (msg.includes('schema error') || msg.includes('no parsed')) {
              retried = true;
              devLog.warn(`[Orchestrator] ${name} retrying after parse error: ${msg}`);
              return await fn(controller.signal);
            }
          }
          throw err;
        }
      })(),
      new Promise<never>((_, reject) => {
        deadlineTimer = setTimeout(() => {
          controller.abort();
          reject(new Error('agent-deadline'));
        }, deadlineMs);
      }),
    ]);
    if (deadlineTimer !== null) {
      clearTimeout(deadlineTimer);
    }
    const durationMs = Date.now() - start;
    const status: AgentDiagnostic['status'] = retried ? 'retry' : 'ok';
    devLog.log(`[Metrics] agent=${name} status=${status} durationMs=${durationMs}`);
    diagnostics.push({ agent: name, durationMs, status });
    return result;
  } catch (err) {
    const durationMs = Date.now() - start;
    const isTimeout = err instanceof Error && err.message === 'agent-deadline';
    const status: AgentDiagnostic['status'] = isTimeout ? 'timeout' : 'fallback';
    devLog.warn(`[Metrics] agent=${name} status=${status} durationMs=${durationMs} error=${err instanceof Error ? err.message : String(err)}`);
    diagnostics.push({ agent: name, durationMs, status });
    return fallback;
  }
}

export function shouldRunCombatAgent(input: NarrationInput): boolean {
  return input.encounterState?.status === 'active';
}

export function shouldRunInventoryAgent(input: NarrationInput): boolean {
  const isActiveCombat = input.encounterState?.status === 'active';
  const isLootTurn = isActiveCombat || !!input.encounterJustResolved;
  return isTradeTurn(input) || isLootTurn;
}

const BUFF_INTENT_SET = new Set(['bless_character', 'aid_character', 'party_boost', 'improve_item']);

export function shouldRunRecoveryAgent(input: NarrationInput): boolean {
  const hasDownedMember = input.party.some(c => c.status === 'downed');
  const hasActiveBuff = input.party.some(c => c.buffs && c.buffs.length > 0);
  const isRestTurn = !!(input.sanctuaryRecovery || input.interventionRescue);
  const isBuffIntent = input.actionIntent ? BUFF_INTENT_SET.has(input.actionIntent) : false;
  return hasDownedMember || hasActiveBuff || isRestTurn || isBuffIntent;
}

function extractStreamingFields(snapshot: string): { rollNarration: string | null; narration: string } {
  const rollMatch = /"rollNarration":"((?:[^"\\]|\\.)*)/.exec(snapshot);
  const narrationMatch = /"narration":"((?:[^"\\]|\\.)*)/.exec(snapshot);
  const unescape = (s: string) =>
    s.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\').replace(/\\r/g, '');
  return {
    rollNarration: rollMatch ? unescape(rollMatch[1]) : null,
    narration: narrationMatch ? unescape(narrationMatch[1]) : '',
  };
}

async function callNarrationAgent(
  input: NarrationInput,
  callbacks: NarrationStreamCallbacks | undefined,
  signal: AbortSignal,
): Promise<NarrationAgentOutput> {
  const model = getModelForTier('narration');
  const systemPrompt = buildNarrationAgentSystemPrompt(input);
  const userContent = buildNarrationUserContent(input);
  const isHighStakes = input.encounterState?.status === 'active'
    || input.sceneMomentum?.directive === 'climax_pressure';
  const maxCompletionTokens = isHighStakes ? 600 : 500;

  const request = {
    model,
    messages: [
      { role: 'system' as const, content: systemPrompt },
      { role: 'user' as const, content: userContent },
    ],
    response_format: zodResponseFormat(narrationAgentOutputSchema, 'narration_agent_output'),
    max_completion_tokens: maxCompletionTokens,
    stream: true as const,
    stream_options: { include_usage: true },
  };

  const stream = createOpenAIClient().chat.completions.stream(request, { signal });

  if (callbacks) {
    let emittedNarration = '';
    let emittedRollNarration = '';
    let rollNarrationDoneFired = false;
    stream.on('content', (_delta: string, snapshot: string) => {
      const { rollNarration, narration } = extractStreamingFields(snapshot);
      if (narration.length > emittedNarration.length) {
        if (!rollNarrationDoneFired) {
          rollNarrationDoneFired = true;
          callbacks.onRollNarrationDone?.(rollNarration);
        }
        callbacks.onChunk(narration.slice(emittedNarration.length), 'narration');
        emittedNarration = narration;
      }
      if (rollNarration !== null && rollNarration.length > emittedRollNarration.length) {
        callbacks.onChunk(rollNarration.slice(emittedRollNarration.length), 'rollNarration');
        emittedRollNarration = rollNarration;
      }
    });
  }

  const response = await stream.finalChatCompletion();
  const message = response.choices[0].message;

  if (message.refusal) {
    throw new Error(`Narration agent refused: ${message.refusal}`);
  }
  if (response.choices[0].finish_reason === 'content_filter') {
    throw new Error(`Narration agent: content filtered`);
  }
  if (!message.parsed) {
    const reason = response.choices[0].finish_reason === 'length'
      ? 'output truncated by max_completion_tokens'
      : 'no parsed structured output';
    throw new Error(`Narration agent: ${reason}`);
  }

  const parsed = narrationAgentOutputSchema.safeParse(message.parsed);
  if (!parsed.success) {
    throw new Error(`Narration agent schema error: ${parsed.error.message}`);
  }

  if (callbacks) {
    callbacks.onStreamingDone(parsed.data.narration, parsed.data.rollNarration ?? null);
  }

  return parsed.data;
}

function choicesUserContent(input: NarrationInput): string {
  return JSON.stringify({
    scene: input.scene,
    tone: input.tone,
    gameMode: input.gameMode,
    isFirstTurn: input.isFirstTurn,
    storySummary: input.storySummary ? input.storySummary.slice(0, 300) : undefined,
    party: input.party.map(c => ({
      name: c.name,
      class: c.class,
      species: c.species,
      hp: c.hp,
      maxHp: c.maxHp,
      status: c.status,
      buffs: c.buffs,
    })),
    actionAttempt: input.actionAttempt,
    actionResult: { success: input.actionResult.success, summary: input.actionResult.summary },
    encounterState: input.encounterState
      ? { status: input.encounterState.status, enemies: input.encounterState.enemies.map(e => ({ name: e.name, hp: e.hp, status: e.status })) }
      : undefined,
    previousChoiceLabels: input.previousChoiceLabels,
    actingCharacterName: input.actingCharacterName,
    nextCharacterName: input.nextCharacterName,
    recentHistory: input.recentHistory?.slice(-2),
  });
}

function combatUserContent(input: NarrationInput): string {
  return JSON.stringify({
    encounterState: input.encounterState,
    actionAttempt: input.actionAttempt,
    actionResult: {
      success: input.actionResult.success,
      impact: input.actionResult.impact,
      summary: input.actionResult.summary,
      statUsed: input.actionResult.statUsed,
    },
    party: input.party.map(c => ({ name: c.name, hp: c.hp, maxHp: c.maxHp, status: c.status })),
    encounterJustResolved: input.encounterJustResolved,
  });
}

function inventoryUserContent(input: NarrationInput): string {
  return JSON.stringify({
    inventory: input.inventory,
    actionAttempt: input.actionAttempt,
    actionResult: { success: input.actionResult.success, summary: input.actionResult.summary },
    encounterState: input.encounterState ? { status: input.encounterState.status } : undefined,
    encounterJustResolved: input.encounterJustResolved,
    encounterLootHint: input.encounterLootHint,
    party: input.party.map(c => ({ name: c.name })),
  });
}

function recoveryUserContent(input: NarrationInput): string {
  const prefix = input.interventionRescue
    ? '[INTERVENTION] Everyone was nearly wiped. They survive at 1 HP. Set suggestedRevive for downed members and suggestedHeal for active members down to 1 HP minimum.\n\n'
    : input.sanctuaryRecovery
      ? '[SANCTUARY] Party woke safely at 1 HP each. Set suggestedHeal for all active members to 1-2 HP.\n\n'
      : '';
  return prefix + JSON.stringify({
    party: input.party.map(c => ({ name: c.name, hp: c.hp, maxHp: c.maxHp, status: c.status, buffs: c.buffs })),
    actionAttempt: input.actionAttempt,
    actionResult: { success: input.actionResult.success, summary: input.actionResult.summary },
    actionIntent: input.actionIntent,
    sanctuaryRecovery: input.sanctuaryRecovery,
    interventionRescue: input.interventionRescue,
  });
}

async function callChoicesAgent(input: NarrationInput, signal: AbortSignal): Promise<ChoicesAgentOutput> {
  // Choices is a simple structured task - use nano to reduce gpt-4.1-mini contention and latency
  const model = getModelForTier('preview');
  const systemPrompt = buildChoicesAgentSystemPrompt(input);
  const userContent = choicesUserContent(input);

  const stream = createOpenAIClient().chat.completions.stream({
    model,
    messages: [
      { role: 'system' as const, content: systemPrompt },
      { role: 'user' as const, content: userContent },
    ],
    response_format: zodResponseFormat(choicesAgentOutputSchema, 'choices_agent_output'),
    max_completion_tokens: 450,
    stream: true as const,
    stream_options: { include_usage: true },
  }, { signal });

  const response = await stream.finalChatCompletion();
  const message = response.choices[0].message;

  if (!message.parsed) {
    throw new Error(`Choices agent: no parsed output`);
  }

  const parsed = choicesAgentOutputSchema.safeParse(message.parsed);
  if (!parsed.success) {
    throw new Error(`Choices agent schema error: ${parsed.error.message}`);
  }

  return parsed.data;
}

async function callCombatAgent(input: NarrationInput, signal: AbortSignal): Promise<CombatAgentOutput> {
  const model = getModelForTier('narration');
  const systemPrompt = buildCombatAgentSystemPrompt(input);
  const userContent = combatUserContent(input);

  const stream = createOpenAIClient().chat.completions.stream({
    model,
    messages: [
      { role: 'system' as const, content: systemPrompt },
      { role: 'user' as const, content: userContent },
    ],
    response_format: zodResponseFormat(combatAgentOutputSchema, 'combat_agent_output'),
    max_completion_tokens: 400,
    stream: true as const,
    stream_options: { include_usage: true },
  }, { signal });

  const response = await stream.finalChatCompletion();
  const message = response.choices[0].message;

  if (!message.parsed) {
    throw new Error(`Combat agent: no parsed output`);
  }

  const parsed = combatAgentOutputSchema.safeParse(message.parsed);
  if (!parsed.success) {
    throw new Error(`Combat agent schema error: ${parsed.error.message}`);
  }

  return parsed.data;
}

async function callInventoryAgent(input: NarrationInput, signal: AbortSignal): Promise<InventoryAgentOutput> {
  const model = getModelForTier('narration');
  const systemPrompt = buildInventoryAgentSystemPrompt(input);
  const userContent = inventoryUserContent(input);

  const stream = createOpenAIClient().chat.completions.stream({
    model,
    messages: [
      { role: 'system' as const, content: systemPrompt },
      { role: 'user' as const, content: userContent },
    ],
    response_format: zodResponseFormat(inventoryAgentOutputSchema, 'inventory_agent_output'),
    max_completion_tokens: 350,
    stream: true as const,
    stream_options: { include_usage: true },
  }, { signal });

  const response = await stream.finalChatCompletion();
  const message = response.choices[0].message;

  if (!message.parsed) {
    throw new Error(`Inventory agent: no parsed output`);
  }

  const parsed = inventoryAgentOutputSchema.safeParse(message.parsed);
  if (!parsed.success) {
    throw new Error(`Inventory agent schema error: ${parsed.error.message}`);
  }

  return parsed.data;
}

async function callRecoveryAgent(input: NarrationInput, signal: AbortSignal): Promise<RecoveryAgentOutput> {
  const model = getModelForTier('narration');
  const systemPrompt = buildRecoveryAgentSystemPrompt(input);
  const userContent = recoveryUserContent(input);

  const stream = createOpenAIClient().chat.completions.stream({
    model,
    messages: [
      { role: 'system' as const, content: systemPrompt },
      { role: 'user' as const, content: userContent },
    ],
    response_format: zodResponseFormat(recoveryAgentOutputSchema, 'recovery_agent_output'),
    max_completion_tokens: 350,
    stream: true as const,
    stream_options: { include_usage: true },
  }, { signal });

  const response = await stream.finalChatCompletion();
  const message = response.choices[0].message;

  if (!message.parsed) {
    throw new Error(`Recovery agent: no parsed output`);
  }

  const parsed = recoveryAgentOutputSchema.safeParse(message.parsed);
  if (!parsed.success) {
    throw new Error(`Recovery agent schema error: ${parsed.error.message}`);
  }

  return parsed.data;
}

function coerceChoice(raw: ChoicesAgentOutput['choices'][0]): NarrationChoice {
  return {
    label: raw.label,
    difficulty: raw.difficulty,
    stat: raw.stat,
    difficultyValue: raw.difficultyValue,
    narration: raw.narration ?? undefined,
    riddleAnswer: raw.riddleAnswer ?? undefined,
    riddleCorrect: raw.riddleCorrect ?? undefined,
    flavor: raw.flavor ?? undefined,
    helperCharacterName: raw.helperCharacterName ?? undefined,
    itemOwnerName: raw.itemOwnerName ?? undefined,
    itemName: raw.itemName ?? undefined,
    environmentFeature: raw.environmentFeature ?? undefined,
  };
}

export class DmTurnOrchestrator {
  async rerunChoices(input: NarrationInput): Promise<NarrationChoice[] | null> {
    const start = Date.now();
    const controller = new AbortController();
    try {
      const result = await Promise.race([
        callChoicesAgent(input, controller.signal),
        new Promise<never>((_, reject) =>
          setTimeout(() => {
            controller.abort();
            reject(new Error('rerun-deadline'));
          }, 2500)
        ),
      ]);
      devLog.log(`[Metrics] choices-rerun status=ok durationMs=${Date.now() - start}`);
      return result.choices.map(coerceChoice);
    } catch (err) {
      devLog.warn(`[Metrics] choices-rerun status=timeout-or-error durationMs=${Date.now() - start} error=${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  async orchestrate(
    input: NarrationInput,
    callbacks?: NarrationStreamCallbacks,
  ): Promise<DmTurnOrchestratorResult> {
    const orchestratorStart = Date.now();
    const diagnostics: AgentDiagnostic[] = [];

    const fallbackOutput = buildNarrationFallback(input);
    const narrationFallback: NarrationAgentOutput = {
      narration: fallbackOutput.narration,
      currentTensionLevel: fallbackOutput.currentTensionLevel,
    };
    const choicesFallback: ChoicesAgentOutput = { choices: fallbackOutput.choices };
    const combatFallback: CombatAgentOutput = {
      suggestedDamage: null,
      suggestedEncounterStart: null,
      suggestedEncounterUpdate: null,
    };
    const inventoryFallback: InventoryAgentOutput = {
      suggestedInventoryAdd: null,
      suggestedInventoryRemove: null,
      suggestedInventoryUpdate: null,
    };
    const recoveryFallback: RecoveryAgentOutput = {
      suggestedRevive: null,
      suggestedHeal: null,
      suggestedBuffAdd: null,
      suggestedBuffRemove: null,
    };

    const runCombat = shouldRunCombatAgent(input);
    const runInventory = shouldRunInventoryAgent(input);
    const runRecovery = shouldRunRecoveryAgent(input);

    devLog.log([
      '[Orchestrator] start',
      `encounter=${input.encounterState?.status ?? 'none'}`,
      `runCombat=${runCombat}`,
      `runInventory=${runInventory}`,
      `runRecovery=${runRecovery}`,
    ].join(' '));

    let callbacksLive = true;
    const gatedCallbacks: NarrationStreamCallbacks | undefined = callbacks
      ? {
        onChunk: (text, field) => {
          if (callbacksLive) {
            callbacks.onChunk(text, field); 
          } 
        },
        onRollNarrationDone: callbacks.onRollNarrationDone
          ? (r) => {
            if (callbacksLive) {
              callbacks.onRollNarrationDone?.(r); 
            } 
          }
          : undefined,
        onStreamingDone: (narration, rollNarration) => {
          if (callbacksLive) {
            callbacks.onStreamingDone(narration, rollNarration); 
          } 
        },
        onAbort: () => {
          if (callbacksLive) {
            callbacks.onAbort?.(); 
          } 
        },
      }
      : undefined;

    const [narration, choices, combat, inventory, recovery] = await Promise.all([
      withDeadline(
        'narration',
        (signal) => callNarrationAgent(input, gatedCallbacks, signal),
        narrationFallback,
        3500,
        diagnostics,
      ),
      withDeadline(
        'choices',
        (signal) => callChoicesAgent(input, signal),
        choicesFallback,
        3500,
        diagnostics,
      ),
      runCombat
        ? withDeadline('combat', (signal) => callCombatAgent(input, signal), combatFallback, 2500, diagnostics, true)
        : Promise.resolve(combatFallback),
      runInventory
        ? withDeadline('inventory', (signal) => callInventoryAgent(input, signal), inventoryFallback, 2500, diagnostics, true)
        : Promise.resolve(inventoryFallback),
      runRecovery
        ? withDeadline('recovery', (signal) => callRecoveryAgent(input, signal), recoveryFallback, 2000, diagnostics, true)
        : Promise.resolve(recoveryFallback),
    ]);

    callbacksLive = false;

    const durationMs = Date.now() - orchestratorStart;
    const agentStatuses = diagnostics.map(d => `${d.agent}:${d.status}(${d.durationMs}ms)`).join(' ');
    devLog.log(`[Metrics] orchestrator durationMs=${durationMs} agents=${diagnostics.length} ${agentStatuses}`);

    const narrationUsedFallback = diagnostics.some(
      d => d.agent === 'narration' && (d.status === 'fallback' || d.status === 'timeout'),
    );
    const choicesUsedFallback = diagnostics.some(
      d => d.agent === 'choices' && (d.status === 'fallback' || d.status === 'timeout'),
    );

    // Zod schemas allow null for optional fields but NarrationOutput uses undefined.
    // Coerce choices explicitly; use runtime-safe casts for complex nested types
    // (same pattern used by OpenAINarrationProvider which casts message.parsed as NarrationOutput).
    return {
      narration: narration.narration,
      rollNarration: narration.rollNarration ?? undefined,
      currentTensionLevel: narration.currentTensionLevel,
      choices: choices.choices.map(coerceChoice),
      suggestedDamage: combat.suggestedDamage ?? null,
      suggestedEncounterStart: (combat.suggestedEncounterStart ?? null) as NarrationOutput['suggestedEncounterStart'],
      suggestedEncounterUpdate: (combat.suggestedEncounterUpdate ?? null) as NarrationOutput['suggestedEncounterUpdate'],
      suggestedInventoryAdd: (inventory.suggestedInventoryAdd ?? null) as NarrationOutput['suggestedInventoryAdd'],
      suggestedInventoryRemove: inventory.suggestedInventoryRemove ?? null,
      suggestedInventoryUpdate: (inventory.suggestedInventoryUpdate ?? null) as NarrationOutput['suggestedInventoryUpdate'],
      suggestedRevive: recovery.suggestedRevive ?? null,
      suggestedHeal: (recovery.suggestedHeal ?? null) as NarrationOutput['suggestedHeal'],
      suggestedBuffAdd: (recovery.suggestedBuffAdd ?? null) as NarrationOutput['suggestedBuffAdd'],
      suggestedBuffRemove: recovery.suggestedBuffRemove ?? null,
      narrationRetried: false,
      narrationFailed: narrationUsedFallback,
      choicesFailed: choicesUsedFallback,
      agentDiagnostics: diagnostics,
    };
  }
}
