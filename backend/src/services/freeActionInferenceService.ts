import type { Character, ChoiceFlavor, InventoryItem, SessionState } from '../types.js';

export const COMBO_HELPER_BONUS = 2;
export const CHOICE_ITEM_BONUS = 2;
export const CHARACTER_EDGE_BONUS = 2;

const FREE_ACTION_MAX_INFERRED_BONUSES = 2;
const SOCIAL_ACTION_RE = /\b(charm|convince|persuade|deceive|trick|lie|bluff|negotiate|bargain|barter|haggle|intimidate|threaten|appeal|plead|comfort|reassure|taunt|distract|perform|sing|talk|speak|ask|question|interrogate|befriend)\b/i;
const SPOTLIGHT_ACTION_RE = /\b(signature|instinct|training|heritage|background|memory|quirk|talent|specialty|speciality|faith|divine|holy|sneak|stealth|shadow|arcane|spell|rage|brute|protect|shield)\b/i;

export type InferredFreeActionBonuses = {
  helperCharacter?: Character;
  choiceItemOwner?: Character;
  choiceItem?: InventoryItem;
  characterEdge?: { label: string; bonus: number; flavor: Extract<ChoiceFlavor, 'social' | 'spotlight'> };
};

export type FreeActionBonusPreview = {
  helperBonus?: number;
  helperCharacterName?: string;
  choiceItemBonus?: number;
  choiceItemName?: string;
  choiceItemOwnerName?: string;
  characterBonus?: number;
  characterBonusLabel?: string;
  flavor?: Extract<ChoiceFlavor, 'social' | 'spotlight'>;
};

const searchable = (text: string | undefined): string => (text ?? '')
  .toLowerCase()
  .normalize('NFKD')
  .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const containsSearchable = (haystack: string, needle: string | undefined): boolean => {
  const normalizedNeedle = searchable(needle);
  return normalizedNeedle.length > 1 && haystack.includes(normalizedNeedle);
};

const firstName = (name: string): string => name.split(/\s+/)[0] ?? name;

const actionReferencesCharacter = (normalizedAction: string, character: Character): boolean =>
  containsSearchable(normalizedAction, character.name) ||
  containsSearchable(normalizedAction, firstName(character.name));

const actionReferencesItem = (normalizedAction: string, item: InventoryItem): boolean =>
  containsSearchable(normalizedAction, item.name) ||
  item.name.split(/\s+/).some(part => containsSearchable(normalizedAction, part));

const actionUsesCharacterSpotlight = (normalizedAction: string, character: Character): boolean => {
  const classOrSpecies = containsSearchable(normalizedAction, character.class) ||
    containsSearchable(normalizedAction, character.species);
  const quirkWords = searchable(character.quirk)
    .split(' ')
    .filter(word => word.length >= 5);
  const historyWords = searchable(character.history)
    .split(' ')
    .filter(word => word.length >= 6);
  const personalWords = [...quirkWords, ...historyWords].some(word => normalizedAction.includes(word));
  return classOrSpecies || personalWords || SPOTLIGHT_ACTION_RE.test(normalizedAction);
};

export const inferFreeActionBonuses = (
  action: string,
  character: Character,
  session: SessionState,
): InferredFreeActionBonuses => {
  const normalizedAction = searchable(action);
  let inferredCount = 0;
  const result: InferredFreeActionBonuses = {};

  const helperCharacter = session.party.find(c =>
    c.id !== character.id &&
    c.status === 'active' &&
    actionReferencesCharacter(normalizedAction, c)
  );
  if (helperCharacter) {
    result.helperCharacter = helperCharacter;
    inferredCount++;
  }

  const itemMatch = session.party
    .filter(c => c.status === 'active')
    .flatMap(owner => owner.inventory.map(item => ({ owner, item })))
    .find(({ item }) => actionReferencesItem(normalizedAction, item));
  if (itemMatch && inferredCount < FREE_ACTION_MAX_INFERRED_BONUSES) {
    result.choiceItemOwner = itemMatch.owner;
    result.choiceItem = itemMatch.item;
    inferredCount++;
  }

  if (inferredCount < FREE_ACTION_MAX_INFERRED_BONUSES) {
    if (SOCIAL_ACTION_RE.test(normalizedAction)) {
      result.characterEdge = { label: 'social edge', bonus: CHARACTER_EDGE_BONUS, flavor: 'social' };
    } else if (actionUsesCharacterSpotlight(normalizedAction, character)) {
      result.characterEdge = { label: 'spotlight', bonus: CHARACTER_EDGE_BONUS, flavor: 'spotlight' };
    }
  }

  return result;
};

export const toFreeActionBonusPreview = (bonuses: InferredFreeActionBonuses): FreeActionBonusPreview => ({
  ...(bonuses.helperCharacter && {
    helperBonus: COMBO_HELPER_BONUS,
    helperCharacterName: bonuses.helperCharacter.name,
  }),
  ...(bonuses.choiceItem && bonuses.choiceItemOwner && {
    choiceItemBonus: CHOICE_ITEM_BONUS,
    choiceItemName: bonuses.choiceItem.name,
    choiceItemOwnerName: bonuses.choiceItemOwner.name,
  }),
  ...(bonuses.characterEdge && {
    characterBonus: bonuses.characterEdge.bonus,
    characterBonusLabel: bonuses.characterEdge.label,
    flavor: bonuses.characterEdge.flavor,
  }),
});
