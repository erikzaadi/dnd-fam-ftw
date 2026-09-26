import { z } from 'zod';

// MCP wire contracts. Outputs are an explicit allowlist of player-facing fields: never
// DM Prep, adventure plans, riddle answers, prompts, diagnostics, storage keys, or
// image URLs (generated images are not access-protected yet). Nullable instead of
// optional, so every field is always present in structured results.

const MAX_ID = 100;

export const adventureIdSchema = z.string().trim().min(1).max(MAX_ID)
  .describe('Adventure ID from list_adventures or create_adventure.');

export const listAdventuresInput = {
  cursor: z.string().max(200).optional().describe('nextCursor from a previous list_adventures result.'),
  limit: z.number().int().min(1).max(25).optional().describe('How many adventures to return (default 10, max 25).'),
};

export const getAdventureInput = {
  adventureId: adventureIdSchema,
  historyLimit: z.number().int().min(1).max(10).optional().describe('How many recent story turns to include (default 3, max 10).'),
  beforeTurnId: z.number().int().positive().optional().describe('Page back: only include turns older than this turn ID (historyCursor from a previous result).'),
};

const adventureStatus = z.enum(['active', 'concluding', 'completed', 'party_defeated']);
const adventureFormat = z.enum(['one_evening', 'long_lived']);

export const adventureListItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: adventureStatus,
  format: adventureFormat,
  turn: z.number(),
  lastPlayedAt: z.string().nullable(),
  party: z.array(z.object({ name: z.string(), class: z.string(), species: z.string() })),
});

export const listAdventuresOutput = {
  adventures: z.array(adventureListItemSchema),
  nextCursor: z.string().nullable(),
};

const statsSchema = z.object({ might: z.number(), magic: z.number(), mischief: z.number() });

export const heroSchema = z.object({
  id: z.string(),
  name: z.string(),
  class: z.string(),
  species: z.string(),
  quirk: z.string(),
  // One sentence about the hero's earlier adventures, for heroes brought from another adventure.
  history: z.string().nullable(),
  hp: z.number(),
  maxHp: z.number(),
  status: z.enum(['active', 'downed']),
  stats: statsSchema,
  inventory: z.array(z.object({
    // Pass as item.itemId to preview_action to use or give this item.
    id: z.string(),
    name: z.string(),
    description: z.string(),
    // For example "+1 might" or "heals 3". Empty when the item has no fixed bonus.
    bonuses: z.array(z.string()),
    consumable: z.boolean(),
    charges: z.number().nullable(),
  })),
  effects: z.array(z.object({
    name: z.string(),
    kind: z.enum(['buff', 'curse']),
    remainingTurns: z.number().nullable(),
  })),
});

export const encounterSchema = z.object({
  name: z.string(),
  round: z.number(),
  objective: z.string().nullable(),
  enemies: z.array(z.object({
    name: z.string(),
    role: z.string(),
    hp: z.number(),
    maxHp: z.number(),
    status: z.string(),
    // Only weaknesses the heroes have already discovered.
    knownWeaknesses: z.array(z.string()),
    traits: z.array(z.string()),
  })),
});

export const operationSchema = z.object({
  id: z.string(),
  requestId: z.string(),
  kind: z.string(),
  status: z.enum(['accepted', 'running', 'completed', 'failed']),
  resultRevision: z.number().nullable(),
  turnId: z.number().nullable(),
  errorCode: z.string().nullable(),
});

export const turnSchema = z.object({
  turnId: z.number().nullable(),
  turnType: z.string(),
  heroName: z.string().nullable(),
  action: z.object({
    text: z.string(),
    success: z.boolean(),
    roll: z.number(),
    target: z.number().nullable(),
    stat: z.string(),
  }).nullable(),
  rollNarration: z.string().nullable(),
  narration: z.string(),
  changes: z.array(z.string()),
  // True when the scene has a picture on the website. The picture itself is not sent.
  hasImage: z.boolean(),
});

export const getAdventureOutput = {
  id: z.string(),
  title: z.string(),
  revision: z.number(),
  turn: z.number(),
  status: adventureStatus,
  format: adventureFormat,
  chapter: z.number().nullable(),
  phase: z.string().nullable(),
  objective: z.string().nullable(),
  resolution: z.string().nullable(),
  wrapUpRequested: z.boolean(),
  // How the party came together, shown before the opening scene. Null until it is written.
  originStory: z.string().nullable(),
  // This player's website setting (on unless "always ask me first"): clean previews go out after an Undo window.
  autoConfirmSafe: z.boolean(),
  // off: no pictures. on_demand: generate_scene_image when the player asks. automatic: every scene.
  imagePolicy: z.enum(['off', 'on_demand', 'automatic']),
  activeHeroId: z.string().nullable(),
  activeHeroName: z.string().nullable(),
  party: z.array(heroSchema),
  encounter: encounterSchema.nullable(),
  activeOperation: operationSchema.nullable(),
  latestOperation: operationSchema.nullable(),
  history: z.array(turnSchema),
  // Pass as beforeTurnId to read older turns. Null when there are none.
  historyCursor: z.number().nullable(),
};

const requestIdSchema = z.string().trim().min(8).max(100)
  .describe('A fresh unique ID you generate for this write (for example a UUID). Reuse the SAME ID when retrying after a timeout or lost response; the server then returns the original result instead of acting twice.');

const expectedRevisionSchema = z.number().int().min(0)
  .describe('The adventure revision you last read (get_adventure or a previous result). If the story moved on, the call is refused and you should read the adventure again.');

export const previewActionInput = {
  adventureId: adventureIdSchema,
  expectedRevision: expectedRevisionSchema,
  action: z.string().trim().min(1).max(600).describe('What the player says their hero tries, in the player\'s own words. Do not embellish or decide the outcome.'),
  clarifications: z.array(z.object({
    question: z.string().min(1).max(300).describe('The question the server asked.'),
    answer: z.string().trim().min(1).max(600).describe('The player\'s own answer.'),
  }).strict()).max(2).optional().describe('Earlier server questions about this same draft and the player\'s answers, oldest first.'),
  item: z.object({
    use: z.enum(['use_item', 'give_item']),
    itemId: z.string().min(1).max(100).describe('Item id from the hero\'s inventory in get_adventure.'),
    ownerHeroId: z.string().min(1).max(100),
    targetHeroId: z.string().min(1).max(100).optional().describe('Required for give_item; optional for using an item on another hero.'),
  }).strict().optional().describe('Only when the player explicitly uses or gives a specific inventory item.'),
  requestId: z.string().trim().min(8).max(100).optional().describe('Optional. Reuse the same ID when retrying this exact preview after a timeout, so it is not paid for twice.'),
};

export const previewActionOutput = {
  outcome: z.enum(['preview', 'clarification']),
  // Pass to confirm_action. Null for a clarification, or when the story moved while previewing.
  previewId: z.string().nullable(),
  revision: z.number(),
  heroName: z.string().nullable(),
  // The server's question when outcome is clarification. Ask the player; never answer it yourself.
  question: z.string().nullable(),
  originalAction: z.string().nullable(),
  interpretedAction: z.string().nullable(),
  stat: z.string().nullable(),
  difficulty: z.string().nullable(),
  target: z.number().nullable(),
  bonuses: z.array(z.string()),
  warnings: z.array(z.string()),
  itemAction: z.object({
    kind: z.enum(['item_use', 'item_give']),
    itemName: z.string(),
    ownerName: z.string(),
    targetName: z.string().nullable(),
  }).nullable(),
  // True for a clean preview (no warnings, gear, or clarification) while the player has
  // not chosen "always ask me first": send it with confirm_action undoWindow true.
  autoConfirmEligible: z.boolean(),
};

export const confirmActionInput = {
  adventureId: adventureIdSchema,
  previewId: z.string().trim().min(1).max(100).describe('previewId from preview_action.'),
  expectedRevision: expectedRevisionSchema,
  requestId: requestIdSchema,
  undoWindow: z.boolean().optional().describe('true when sending an autoConfirmEligible preview without asking: the server waits a few seconds first, and the player can stop it by interrupting this call (Esc). Leave false after the player explicitly confirmed.'),
};

export const operationResultOutput = {
  operation: operationSchema,
  replayed: z.boolean(),
  // Suggested wait before calling get_operation.
  retryAfterSeconds: z.number().nullable(),
};

export const getOperationInput = {
  adventureId: adventureIdSchema,
  operationId: z.string().trim().min(1).max(100).optional().describe('Operation id from confirm_action, create_adventure, or manage_adventure.'),
  requestId: z.string().trim().min(1).max(100).optional().describe('The requestId of a write whose response was lost. Use when you have no operationId.'),
  waitSeconds: z.number().int().min(0).max(25).optional().describe('Wait up to this many seconds for the operation to finish before answering (default 20).'),
};

export const getOperationOutput = {
  operation: operationSchema,
  done: z.boolean(),
  revision: z.number().nullable(),
  // Turns this operation committed, oldest first (an action can also add rescue or ending turns).
  turns: z.array(turnSchema),
  retryAfterSeconds: z.number().nullable(),
  message: z.string().nullable(),
  // Set when the operation's turns were part of a fight: started (with the foes), still
  // going (with their health), or ended. summary is ready-to-show text.
  combat: z.object({
    started: z.boolean(),
    ended: z.boolean(),
    outcome: z.enum(['active', 'defeated', 'fled', 'surrendered', 'resolved']),
    encounter: encounterSchema,
    summary: z.array(z.string()),
  }).nullable(),
  // Only for a completed start operation (a new adventure's opening): present this before the opening scene.
  opening: z.object({
    title: z.string(),
    originStory: z.string().nullable(),
    party: z.array(z.object({
      name: z.string(),
      class: z.string(),
      species: z.string(),
      quirk: z.string(),
      history: z.string().nullable(),
    })),
  }).nullable(),
};

export const askDmInput = {
  adventureId: adventureIdSchema,
  question: z.string().trim().min(1).max(300).describe('The player\'s out-of-character question about the current scene, in their words.'),
};

export const askDmOutput = {
  answer: z.string(),
  turnId: z.number(),
  revision: z.number(),
};

const heroText = (max: number) => z.string().trim().min(1).max(max);

export const createAdventureInput = {
  premise: z.string().trim().min(3).max(600).describe('The player\'s idea for the adventure in their words, e.g. "a silly forest adventure with a grumpy troll".'),
  heroes: z.union([
    z.literal('auto'),
    z.array(z.object({
      name: heroText(40),
      class: heroText(40).describe('e.g. Wizard, Knight, Rogue, Bard.'),
      species: heroText(40).describe('e.g. Elf, Gnome, Talking Cat.'),
      quirk: z.string().trim().max(120).optional(),
    }).strict()).min(1).max(5),
  ]).optional().describe('"auto" (default) lets the DM make the party. Or describe heroes; the server sets their stats and hit points.'),
  partySize: z.number().int().min(1).max(5).optional().describe('Only with heroes "auto": how many heroes (default 3).'),
  format: z.enum(['one_evening', 'long_lived']).optional().describe('one_evening (default): a story that ends tonight. long_lived only if the player asks for an ongoing campaign.'),
  images: z.enum(['off', 'on_demand']).optional().describe('off (default): text only. on_demand: the player may ask for pictures of scenes later (generate_scene_image).'),
  requestId: requestIdSchema,
};

export const createAdventureOutput = {
  adventureId: z.string(),
  operation: operationSchema.nullable(),
  replayed: z.boolean(),
  retryAfterSeconds: z.number().nullable(),
};

export const manageAdventureInput = {
  adventureId: adventureIdSchema,
  action: z.enum(['wrap_up', 'end_here', 'continue_world', 'retry_opening', 'set_images']).describe(
    'wrap_up: steer the story toward its finale over the next turns. end_here: end now with an epilogue. continue_world: start a new chapter after a completed adventure. retry_opening: start an opening scene that failed to generate. set_images: change when pictures are painted (affects everyone playing this adventure).',
  ),
  images: z.enum(['off', 'on_demand', 'automatic']).optional().describe('Only for set_images: off, on_demand (only when asked), or automatic (every scene, costs more).'),
  expectedRevision: expectedRevisionSchema,
  requestId: requestIdSchema,
  format: z.enum(['one_evening', 'long_lived']).optional().describe('Only for continue_world (default one_evening).'),
};

export const manageAdventureOutput = {
  action: z.string(),
  // Set for end_here, continue_world, and retry_opening: wait for it with get_operation.
  operation: operationSchema.nullable(),
  replayed: z.boolean(),
  revision: z.number().nullable(),
  retryAfterSeconds: z.number().nullable(),
};

export const sceneImageInput = {
  adventureId: adventureIdSchema,
  turnId: z.number().int().positive().describe('turnId from get_adventure or get_operation.'),
};

export const generateSceneImageInput = {
  ...sceneImageInput,
  requestId: requestIdSchema,
};

export type AdventureListItem = z.infer<typeof adventureListItemSchema>;
export type McpHero = z.infer<typeof heroSchema>;
export type McpEncounter = z.infer<typeof encounterSchema>;
export type McpOperation = z.infer<typeof operationSchema>;
export type McpTurn = z.infer<typeof turnSchema>;
export type AdventureView = z.infer<z.ZodObject<typeof getAdventureOutput>>;
export type AdventureListView = z.infer<z.ZodObject<typeof listAdventuresOutput>>;
export type PreviewActionView = z.infer<z.ZodObject<typeof previewActionOutput>>;
export type GetOperationView = z.infer<z.ZodObject<typeof getOperationOutput>>;
