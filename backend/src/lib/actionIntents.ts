// Free-action intents a client can attach to a preview or turn. Previews, prompts and
// resolution all read these lists, so a new intent is added here once.
export const PREVIEW_ACTION_INTENTS = ['use_item_scene', 'improve_item', 'bless_character', 'aid_character', 'party_boost'] as const;
export type PreviewActionIntent = typeof PREVIEW_ACTION_INTENTS[number];

const BUFFS: PreviewActionIntent[] = ['bless_character', 'aid_character', 'party_boost'];

// Intents that buff a hero or the party.
export const BUFF_INTENTS: ReadonlySet<string> = new Set(BUFFS);

// Helping someone (buffs and improving an item): never punishes the actor on failure.
export const SUPPORT_INTENTS: ReadonlySet<string> = new Set([...BUFFS, 'improve_item']);
