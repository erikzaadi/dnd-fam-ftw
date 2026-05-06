import type { NarrationInput, NarrationOutput } from './NarrationProvider.js';
import { narrationOutputSchema } from './narrationSchemas.js';

const PORTAL_CHOICE_RE = /\b(portal|shortcut|teleport|teleportation|gateway|rift|waygate)\b/i;
const PORTAL_NARRATION_RE = /\b(portal|shortcut|teleport|teleportation|gateway|rift|waygate)\b/i;
const NPC_RE = /\b(npc|figure|stranger|spirit|sprite|fairy|fae|pixie|courier|messenger|guide|scout|herald|mage|wizard|witch|seer|priest|druid|merchant|vendor|traveler|ally|patron|summoner|guardian|keeper|voice)\b/i;
const OFFER_OR_ACTIVATE_RE = /\b(offer|offers|offered|offering|beckon|beckons|beckoning|gesture|gestures|gesturing|point|points|pointing|motion|motions|motioning|wave|waves|waving|urge|urges|urging|invite|invites|inviting|open|opens|opened|opening|activate|activates|activated|activating|summon|summons|summoned|summoning|create|creates|created|creating|conjure|conjures|conjured|conjuring|tear|tears|tore|tearing|signal|signals|signaling|signalling)\b/i;

const choiceText = (choice: NarrationOutput['choices'][number]) => `${choice.label} ${choice.narration ?? ''}`;

function hasPortalChoice(output: NarrationOutput): boolean {
  return output.choices.some(choice => PORTAL_CHOICE_RE.test(choiceText(choice)));
}

function narrationHasNpcPortalOffer(output: NarrationOutput): boolean {
  return PORTAL_NARRATION_RE.test(output.narration)
    && NPC_RE.test(output.narration)
    && OFFER_OR_ACTIVATE_RE.test(output.narration);
}

export function validateNarrationOutput(input: NarrationInput, output: NarrationOutput): string[] {
  const errors: string[] = [];
  if (hasPortalChoice(output) && !narrationHasNpcPortalOffer(output)) {
    errors.push('Portal, shortcut, or teleport choices require this turn narration to show an NPC offering or activating one.');
  }

  if ((input.gameMode === 'zug-ma-geddon') && output.currentTensionLevel !== 'high') {
    errors.push('zug-ma-geddon turns must keep currentTensionLevel high.');
  }

  for (const choice of output.choices) {
    if (choice.flavor === 'combo') {
      const helper = input.party.find(c => c.name === choice.helperCharacterName);
      if (!helper || helper.status !== 'active' || helper.name === input.nextCharacterName) {
        errors.push('Combo choices must include helperCharacterName for an active ally.');
      }
    }

    if (choice.flavor === 'item') {
      const item = input.inventory.find(i => i.ownerName === choice.itemOwnerName && i.name === choice.itemName);
      if (!item) {
        errors.push('Item choices must reference an existing itemOwnerName and itemName from inventory.');
      }
    }

    if (choice.flavor === 'environment' && !choice.environmentFeature) {
      errors.push('Environment choices must include environmentFeature.');
    }
  }

  return errors;
}

export function parseNarrationOutput(input: NarrationInput, raw: unknown): { success: true; data: NarrationOutput } | { success: false; error: string } {
  const parsed = narrationOutputSchema.safeParse(raw);
  if (!parsed.success) {
    return { success: false, error: parsed.error.message };
  }

  const guardErrors = validateNarrationOutput(input, parsed.data);
  if (guardErrors.length > 0) {
    return { success: false, error: guardErrors.join(' ') };
  }

  return { success: true, data: parsed.data };
}
