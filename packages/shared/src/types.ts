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
    weaknesses: Array<{ label: string; school?: EncounterWeakness['school'] }>;
    traits?: string[];
  }>;
  areas: Array<{ label: string; tags: string[] }>;
  objective?: string;
  lootHint?: string;
}

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
  label: string;
  difficulty: Difficulty;
  stat: Stat;
  difficultyValue?: number;
  narration?: string;
  riddleAnswer?: string;
  riddleCorrect?: boolean;
  flavor?: ChoiceFlavor;
  helperCharacterName?: string;
  itemOwnerName?: string;
  itemName?: string;
  environmentFeature?: string;
}

export type TurnType = 'normal' | 'intervention' | 'sanctuary';

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
  };
}

export interface TurnResult {
  id?: number;
  narration: string;
  choices: Choice[];
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
  narrationRetried?: boolean;
  narrationFailed?: boolean;
  narrationValidationError?: string;
  narrationRetryValidationError?: string;
  suggestedEncounterStart?: unknown | null;
  suggestedEncounterUpdate?: unknown | null;
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
  previewImageUrl?: string;
  party: { id: string; name: string; class: string; species: string; avatarUrl?: string; hp: number; max_hp: number }[];
}

export interface Session {
  id: string;
  scene: string;
  turn: number;
  party: Character[];
  activeCharacterId: string;
  displayName: string;
  savingsMode: boolean;
  gameMode?: GameMode;
  interventionState: InterventionState;
  gameOver?: boolean;
  previewImageUrl?: string;
  encounterState?: EncounterState;
  pastEncounters?: EncounterState[];
}

export interface AppSettings {
  imagesEnabled: boolean;
}

export interface Capabilities {
  hasCloudAI: boolean;
  hasTts: boolean;
}

export type SessionListEventType = 'connected' | 'heartbeat' | 'session_changed' | 'preview_image_available' | 'instant_start_ready';

export interface FreeActionPreview {
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
