export type CharacterStatus = 'active' | 'downed';

export type GameMode = 'cinematic' | 'balanced' | 'fast' | 'zug-ma-geddon';
export type Stat = 'might' | 'magic' | 'mischief';
export type Difficulty = 'easy' | 'normal' | 'hard';
export type TensionLevel = 'low' | 'medium' | 'high';
export type Impact = 'normal' | 'strong' | 'extreme';
export type ChoiceFlavor = 'standard' | 'spotlight' | 'combo' | 'social' | 'item' | 'environment';
export type ScenePressureKind = 'combat' | 'challenge' | 'calm' | 'unknown';
export type MomentumDirective =
  | 'start_scene'
  | 'press_current_scene'
  | 'close_combat'
  | 'victory_exit'
  | 'advance_campaign'
  | 'climax_pressure';

export interface ScenePressure {
  kind: ScenePressureKind;
  pressureTurns: number;
  successfulPressureTurns: number;
  previousTensionLevels: TensionLevel[];
  reason: string;
}

export interface SceneMomentum {
  directive: MomentumDirective;
  staleChoiceCount: number;
  turnsSinceSceneChange: number;
  turnsSinceCombat: number;
  justCompletedCombat: boolean;
  justCompletedDifficultChallenge: boolean;
  suggestedNextBeat: string;
  reason: string;
}

export interface InventoryItem {
  id: string;
  name: string;
  description: string;
  statBonuses?: { might?: number; magic?: number; mischief?: number };
  healValue?: number;
  transferable?: boolean;
  consumable?: boolean;
  tags?: string[];
  effect?: string;
  charges?: number;
  condition?: string;
  boundToCharacterId?: string;
}

export interface BaseEffect {
  id: string;
  name: string;
  description: string;
  statBonuses?: { might?: number; magic?: number; mischief?: number };
  damagePerTurn?: number;
  remainingTurns?: number;
  remainingUses?: number;
  sourceCharacterName?: string;
}

export interface CharacterBuff extends BaseEffect {
  kind?: 'buff' | 'curse';
}

export interface EncounterEffect extends BaseEffect {
  kind: 'buff' | 'curse' | 'damage_over_time' | 'control' | 'marked';
}

export interface EncounterWeakness {
  // Player-facing flavor label. Mechanics use school/stat below.
  id: string;
  label: string;
  school?: 'fire' | 'frost' | 'light' | 'shadow' | 'nature' | 'storm' | 'mind' | 'force' | 'holy' | 'mechanical';
  stat?: 'might' | 'magic' | 'mischief';
  damageMultiplier?: number;
  bonusDamage?: number;
  revealed: boolean;
  broken?: boolean;
}

export interface EncounterResistance {
  id: string;
  label: string;
  school?: EncounterWeakness['school'];
  stat?: EncounterWeakness['stat'];
  damageMultiplier: number;
}

export interface EncounterArea {
  id: string;
  label: string;
  description: string;
  tags: string[];
  effect?: string;
  imageUrl?: string;
}

export interface EncounterEnemy {
  id: string;
  name: string;
  aliases?: string[];
  role: 'minion' | 'standard' | 'elite' | 'boss' | 'hazard';
  hp: number;
  maxHp: number;
  armor?: number;
  traits?: string[];
  weaknesses?: EncounterWeakness[];
  resistances?: EncounterResistance[];
  effects?: EncounterEffect[];
  intent?: string;
  status: 'active' | 'defeated' | 'fled' | 'surrendered';
  avatarUrl?: string;
}

export interface EncounterEnemyChange {
  enemyId: string;
  enemyName: string;
  hpChange: number;
  newStatus?: EncounterEnemy['status'];
}

export interface EncounterState {
  id: string;
  name: string;
  status: 'active' | 'defeated' | 'fled' | 'surrendered' | 'resolved';
  enemies: EncounterEnemy[];
  areas: EncounterArea[];
  round: number;
  objective?: string;
  lastResolvedEnemyName?: string;
}

export interface EncounterSeed {
  name: string;
  triggerHint: string;
  enemies: Array<{
    name: string;
    role: EncounterEnemy['role'];
    weaknesses?: Array<{ label: string; school?: EncounterWeakness['school'] }>;
    traits?: string[];
    avatarUrl?: string;
  }>;
  areas: Array<{ label: string; tags: string[]; effect?: string; imageUrl?: string }>;
  objective?: string;
  lootHint?: string;
}

export interface EncounterStartProposal {
  name: string;
  enemies: Array<{
    name: string;
    role: EncounterEnemy['role'];
    traits?: string[] | null;
    weaknesses?: Array<{ label: string; school?: EncounterWeakness['school'] | null }> | null;
  }>;
  areas?: Array<{
    label: string;
    description?: string | null;
    tags?: string[] | null;
  }> | null;
  objective?: string | null;
  lootHint?: string | null;
}

export type ImageReadyPayload =
  | { target: 'scene'; imageUrl: string; turnId: number }
  | { target: 'encounter_enemy'; encounterId: string; enemyId: string; imageUrl: string }
  | { target: 'encounter_area'; encounterId: string; areaId: string; imageUrl: string }
  | { target: 'character_avatar'; characterId: string; imageUrl: string }
  | { target: 'session_preview'; imageUrl: string };

export type ImageReadyEvent = { type: 'image_ready' } & ImageReadyPayload;

export interface Character {
  id: string;
  name: string;
  class: string;
  species: string;
  quirk: string;
  hp: number;
  max_hp: number;
  status: CharacterStatus;
  avatarUrl?: string;
  avatarPrompt?: string;
  avatarStorageKey?: string;
  avatarStorageProvider?: string;
  gender?: string;
  history?: string;
  sessionName?: string;
  stats: {
    might: number;
    magic: number;
    mischief: number;
  };
  inventory: InventoryItem[];
  buffs?: CharacterBuff[];
}

export interface InterventionState {
  rescuesUsed: number;
}

export interface Choice {
  // Stable id of a stored suggestion (turn_choices row). Only choices of the latest
  // turn are valid to submit; older ids are rejected as stale.
  id?: number;
  label: string;
  difficulty: Difficulty;
  stat: Stat;
  difficultyValue?: number;
  narration?: string;
  // Public marker: this choice answers a riddle, so it resolves without a roll.
  // Which answer is right is server-only (the backend Choice type in backend/src/types.ts).
  kind?: 'riddle_answer';
  flavor?: ChoiceFlavor;
  helperCharacterName?: string;
  itemOwnerName?: string;
  itemName?: string;
  environmentFeature?: string;
}

// conclusion: the adventure's ending (no choices). chapter_start: opening of a continued world.
export type TurnType = 'normal' | 'intervention' | 'sanctuary' | 'conclusion' | 'chapter_start';

// Adventure lifecycle. Independent of difficulty, pacing (gameMode) and interaction mode.
export type AdventureFormat = 'one_evening' | 'long_lived';
// Separate from party-wipe gameOver: completed means the story reached a deliberate ending.
export type AdventureStatus = 'active' | 'concluding' | 'completed';
export type AdventurePhase = 'opening' | 'development' | 'finale' | 'epilogue';
export type AdventureResolution = 'success' | 'setback' | 'ended_early';
// Narration's proposal about the chapter objective. The server accepts a resolution
// only when committed facts (roll result, encounter outcome) support it.
export type ObjectiveOutcome = 'none' | 'advanced' | 'resolved_success' | 'resolved_setback';

// Persisted chapter progress. Contains no private DM material.
export interface AdventureArcState {
  chapter: number;
  phase: AdventurePhase;
  // Committed player actions in this chapter (initial, rescue and conclusion turns do not count).
  playerActionCount: number;
  // Count at which the current one-evening budget started (reset when switching back from long-lived).
  budgetStartCount: number;
  participatingHeroIds: string[];
  wrapUpRequested: boolean;
  finaleStartedAtCount?: number;
  // Failed decisive attempts during the finale (a setback ending needs at least one earlier failure).
  decisiveAttempts: number;
  // Set when the finale ran long without resolution: views offer keep playing or end here.
  continueOffered?: boolean;
  resolution?: AdventureResolution;
  conclusionTurnId?: number;
}

export interface AdventureProgress extends AdventureArcState {
  format: AdventureFormat;
  status: AdventureStatus;
  objective?: string;
  // One-evening pacing targets in playerActionCount terms (absent for long-lived).
  finaleTargetAt?: number;
  resolveByTarget?: number;
}

export interface HpChange {
  characterId: string;
  characterName: string;
  change: number;
  newHp: number;
  maxHp: number;
}

export interface InventoryChange {
  characterName: string;
  itemName: string;
  type: 'added' | 'removed' | 'updated';
}

export interface BuffChange {
  characterName: string;
  buffName: string;
  kind: 'buff' | 'curse';
  type: 'added' | 'removed';
}

export interface ActionAttempt {
  actionAttempt: string;
  actionResult: {
    success: boolean;
    roll: number;
    statUsed: Stat | 'none';
    statBonus?: number;
    itemBonus?: number;
    helperBonus?: number;
    helperCharacterName?: string;
    choiceItemBonus?: number;
    choiceItemName?: string;
    choiceItemOwnerName?: string;
    characterBonus?: number;
    characterBonusLabel?: string;
    buffBonus?: number;
    buffBonusLabel?: string;
    impact?: Impact;
    isCritical?: boolean;
    difficultyTarget?: number;
    // The action's own difficulty label (choice, confirmed preview, or submitted).
    difficulty?: Difficulty;
  };
}

export type AgentErrorKind =
  | 'refusal'
  | 'content_filter'
  | 'length'
  | 'no_parsed'
  | 'schema'
  | 'network'
  | 'timeout';

export interface AgentDiagnostic {
  agent: string;
  durationMs: number;
  status: 'ok' | 'timeout' | 'fallback' | 'retry';
  errorKind?: AgentErrorKind;
  errorMessage?: string;
}

export interface TurnResult {
  id?: number;
  encounterId?: string;
  narration: string;
  choices: Choice[];
  // Suggested choices are current only for this revision and acting hero. Missing on
  // turns from before ideas existed: then they count as current while the turn is latest.
  ideasRevision?: number;
  ideasCharacterId?: string;
  // The ideas came from the deterministic fallback, not the model.
  ideasDegraded?: boolean;
  rollNarration?: string;
  imagePrompt: string | null;
  imageSuggested: boolean;
  imageUrl?: string | null;
  suggestedInventoryAdd?: (Omit<InventoryItem, 'id'> & { targetCharacterName?: string; boundToCharacterName?: string }) | null;
  suggestedInventoryRemove?: { characterName: string; itemName: string } | null;
  suggestedInventoryUpdate?: {
    characterName: string;
    itemName: string;
    name?: string;
    description?: string;
    statBonuses?: { might?: number; magic?: number; mischief?: number };
    healValue?: number;
    consumable?: boolean;
    transferable?: boolean;
    tags?: string[];
    effect?: string;
    charges?: number;
    condition?: string;
    boundToCharacterName?: string;
  } | null;
  suggestedRevive?: { characterName: string; hp: number } | null;
  suggestedHeal?: Array<{ characterName: string; hp: number }> | null;
  suggestedBuffAdd?: Array<{ characterName: string } & Omit<CharacterBuff, 'id'>> | null;
  suggestedBuffRemove?: { characterName: string; buffName: string } | null;
  suggestedDamage?: number | null;
  lastAction?: ActionAttempt | null;
  characterId?: string;
  turnType?: TurnType;
  currentTensionLevel?: TensionLevel;
  hpChanges?: HpChange[];
  inventoryChanges?: InventoryChange[];
  buffChanges?: BuffChange[];
  encounterEnemyChanges?: EncounterEnemyChange[];
  narrationRetried?: boolean;
  narrationFailed?: boolean;
  choicesFailed?: boolean;
  choicesEscalated?: boolean;
  narrationValidationError?: string;
  narrationRetryValidationError?: string;
  suggestedEncounterStart?: EncounterStartProposal | null;
  suggestedEncounterUpdate?: unknown | null;
  objectiveOutcome?: ObjectiveOutcome | null;
  agentDiagnostics?: AgentDiagnostic[];
}

export interface SessionPreview {
  id: string;
  displayName: string;
  worldDescription?: string;
  storySummary?: string;
  dmPrep?: string;
  difficulty: string;
  gameMode: string;
  gameOver?: boolean;
  adventureFormat?: AdventureFormat;
  adventureStatus?: AdventureStatus;
  previewImageUrl?: string;
  party: { id: string; name: string; class: string; species: string; avatarUrl?: string; hp: number; max_hp: number }[];
}

// riddle_recovery: server-initiated, closes a riddle whose answer could not be found.
export type SessionOperationKind = 'action' | 'start' | 'wrap_up' | 'end_here' | 'continue_world' | 'riddle_recovery';
export type SessionOperationStatus = 'accepted' | 'running' | 'completed' | 'failed';
// resolving: normal turn work. recovering: rescue/sanctuary follow-up after a party wipe.
// concluding: generating a finale or epilogue.
export type SessionOperationPhase = 'resolving' | 'recovering' | 'concluding';

export interface SessionOperation {
  id: string;
  requestId: string;
  kind: SessionOperationKind;
  status: SessionOperationStatus;
  phase?: SessionOperationPhase;
  baseRevision: number;
  resultRevision?: number;
  turnId?: number;
  errorCode?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

// 409 responses from mutation endpoints. All are retryable after the client refreshes.
export type OperationConflictCode = 'operation_in_progress' | 'stale_revision' | 'request_id_conflict' | 'adventure_completed' | 'stale_preview' | 'preview_mismatch' | 'item_unavailable' | 'riddle_unclear' | 'riddle_answer_unknown' | 'clarification_limit';

export interface OperationAcceptedResponse {
  queued: boolean;
  replayed?: boolean;
  operation: SessionOperation;
}

export interface Session {
  id: string;
  scene: string;
  turn: number;
  // Incremented by every committed gameplay or settings mutation.
  revision?: number;
  // Onboarding only: the first viewer asks for ideas once, by itself.
  onboardingIdeasPending?: boolean;
  // Realm setting "Suggest ideas each turn": views ask for ideas once per new turn.
  autoIdeas?: boolean;
  party: Character[];
  activeCharacterId: string;
  displayName: string;
  savingsMode: boolean;
  gameMode?: GameMode;
  adventure?: AdventureProgress;
  interventionState: InterventionState;
  gameOver?: boolean;
  previewImageUrl?: string;
  encounterState?: EncounterState;
  pastEncounters?: EncounterState[];
  originStory?: string;
  originStoryImageUrl?: string;
}

// Coherent view used to reconcile a client after (re)connecting.
export interface SessionSnapshot {
  revision: number;
  session: Session;
  history: TurnResult[];
  activeOperation: SessionOperation | null;
  latestOperation: SessionOperation | null;
}

export interface AppSettings {
  imagesEnabled: boolean;
}

export type SignupMode = 'invite_only' | 'open';

// Usage tiers, shown as "Adventurer", "Patron of the Realm", and "Founding Realm".
export type UsageTier = 'free' | 'supporter' | 'unlimited';

export type UsageLimitKind = 'text' | 'pictures' | 'sessions' | 'turns';

// GET /namespace/usage: the signed-in group's tier, limits, and today's usage.
// null limits are unlimited.
export interface NamespaceUsageResponse {
  tier: UsageTier;
  tierLabel: string;
  // When a donation upgrade runs out (ISO), or null for tiers that do not expire.
  tierExpiresAt: string | null;
  limits: {
    textCreditsPerDay: number | null;
    picturesPerDay: number | null;
    maxSessions: number | null;
    maxTurns: number | null;
  };
  today: {
    textCredits: number;
    pictures: number;
  };
  sessionCount: number;
  // Next daily reset (ISO, 00:00 UTC).
  resetsAt: string;
  // Pictures are paused (daily picture budget spent, or the realm-wide spend limit).
  picturesPaused: boolean;
  // Donation page for "Support the realm", or null when not configured.
  supportUrl: string | null;
  // Days of higher limits a donation from the sign-in email grants, or null when
  // donations are not matched automatically.
  donationUpgradeDays: number | null;
  // The group's open "Ask for more" request, if any.
  limitRequest: { status: 'pending'; createdAt: string } | null;
}

// POST /namespace/limit-request
export interface LimitRequestBody {
  note?: string;
}

export interface LimitRequestErrorResponse {
  error: 'already_requested' | 'not_needed' | 'too_many_requests';
  message: string;
}

// Error body for requests refused by a usage limit (HTTP 429).
export interface LimitReachedResponse {
  error: 'limit_reached';
  kind: UsageLimitKind;
  tier: UsageTier;
  message: string;
  // When the daily budget resets (ISO), or null for limits that do not reset.
  resetsAt: string | null;
}

// GET /auth/config: public, never contains secrets.
export interface AuthConfigResponse {
  enabled: boolean;
  signupMode: SignupMode;
  providers: {
    google: boolean;
    email: boolean;
  };
}

// POST /auth/email/start (202)
export interface EmailSignInStartResponse {
  challengeId: string;
  maskedEmail: string;
  resendAfterSeconds: number;
  expiresInSeconds: number;
}

// POST /auth/email/resend (200)
export interface EmailSignInResendResponse {
  resendAfterSeconds: number;
  expiresInSeconds: number;
}

// POST /auth/email/verify (200): where the app should go next, relative to its base path.
export interface EmailSignInVerifyResponse {
  next: '/' | '/namespace-picker' | '/request-invite';
}

// Error bodies from the /auth/email/* endpoints.
export interface EmailSignInErrorResponse {
  error: 'invalid_email' | 'invalid_code' | 'expired' | 'rate_limited' | 'email_unavailable';
  attemptsLeft?: number;
  retryAfterSeconds?: number;
}

// GET /auth/me
export interface AuthMeResponse {
  enabled: boolean;
  email: string | null;
  namespaceId: string;
}

export interface Capabilities {
  hasCloudAI: boolean;
  hasTts: boolean;
  ttsLegacyModel: boolean;
}

export const OPENAI_TTS_VOICES = ['cedar', 'marin', 'fable', 'onyx', 'nova', 'sage', 'shimmer'] as const;
export type OpenAiTtsVoice = typeof OPENAI_TTS_VOICES[number];

export const OPENAI_TTS_VOICE_LABELS: Record<OpenAiTtsVoice, string> = {
  cedar:   'Cedar (warm narrator)',
  marin:   'Marin (clear narrator)',
  fable:   'Fable (storybook)',
  onyx:    'Onyx (deep)',
  nova:    'Nova (bright)',
  sage:    'Sage (calm)',
  shimmer: 'Shimmer (light)',
};

// cedar and marin require gpt-4o-mini-tts; not available on tts-1 / tts-1-hd
export const OPENAI_TTS_VOICES_GPT4O_ONLY = new Set<OpenAiTtsVoice>(['cedar', 'marin']);

export const OPENAI_TTS_DEFAULT_VOICE: OpenAiTtsVoice = 'cedar';

export type SessionListEventType = 'connected' | 'heartbeat' | 'session_changed' | 'preview_image_available' | 'instant_start_ready';

// One question-and-answer round about a draft action. The client carries the whole
// exchange with the original draft, so the server can read them together.
// POST /session/:id/ask response: a short DM answer to an out-of-character question
// ("Ask the DM"). Transient: never stored, never advances the story.
export interface AskDmPayload {
  turnId: number;
  revision: number;
  question: string;
  answer: string;
}

// POST /session/:id/ideas response and the ideas_updated event payload.
export interface IdeasPayload {
  turnId: number;
  revision: number;
  characterId: string;
  choices: Choice[];
  degraded: boolean;
}

export interface ActionClarification {
  question: string;
  answer: string;
}

// Returned by /preview-action instead of a preview when the server needs one more
// detail. Nothing is stored or mutated; the player answers and previews again.
export interface PreviewClarification {
  kind: 'clarification';
  question: string;
  previewRevision: number;
}

export interface FreeActionPreview {
  // Server-issued handle binding this preview's mechanics to the session revision.
  // Sent back on confirmation; a stale handle is rejected so the player re-previews.
  previewId?: string;
  // Set for a draft with gear attached (use/give an item): resolved without a roll.
  itemAction?: {
    kind: 'item_use' | 'item_give';
    itemName: string;
    ownerName: string;
    targetName?: string;
  };
  originalAction: string;
  interpretedAction: string;
  narration?: string;
  stat: Stat;
  difficulty: Difficulty;
  difficultyValue?: number;
  warnings: string[];
  helperBonus?: number;
  helperCharacterName?: string;
  choiceItemBonus?: number;
  choiceItemName?: string;
  choiceItemOwnerName?: string;
  characterBonus?: number;
  characterBonusLabel?: string;
  flavor?: ChoiceFlavor;
  pendingIntent?: string;
  pendingTargetCharacterId?: string;
  school?: 'fire' | 'frost' | 'light' | 'shadow' | 'nature' | 'storm' | 'mind' | 'force' | 'holy' | 'mechanical' | null;
  actionTags?: string[];
  likelyEnemyId?: string;
  likelyEnemyName?: string;
  weakPointMatch?: { label: string; description: string } | null;
}
