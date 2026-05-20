import type { Session, TurnResult, Choice, Character } from '../../types';

/**
 * Sanitizes text to be spoken by a text-to-speech engine.
 * Strips markdown headers, bold, italics, code, links, emojis/unicode symbols,
 * and collapses multiple spaces.
 */
export function sanitizeText(text: string): string {
  if (!text) {
    return '';
  }
  return text
    .replace(/#{1,6}\s+/g, '')       // strip markdown headers
    .replace(/\*\*(.+?)\*\*/g, '$1') // strip bold
    .replace(/\*(.+?)\*/g, '$1')     // strip italic
    .replace(/_(.+?)_/g, '$1')       // strip underscore italic
    .replace(/`(.+?)`/g, '$1')       // strip inline code
    .replace(/\[(.+?)\]\(.+?\)/g, '$1') // strip links, keep label
    // strip emojis and common unicode symbols/dingbats
    .replace(/[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF]/g, '')
    .replace(/\s+([.,!?])/g, '$1')   // remove spaces before punctuation
    .replace(/\s{2,}/g, ' ')         // collapse multiple spaces
    .trim();
}

/**
 * Builds the roll result segment from turn metadata.
 * Skips dice details for sanctuary/intervention and other no-roll turns.
 */
export function buildRollResultSegment(turn: TurnResult): string {
  const parts: string[] = [];
  const ar = turn.lastAction?.actionResult;
  
  if (ar && ar.statUsed && ar.statUsed !== 'none' && ar.roll) {
    const outcome = ar.success ? 'Success!' : 'Failure.';
    parts.push(`${outcome} Rolled a ${ar.roll} for ${ar.statUsed}.`);
  }
  
  if (turn.rollNarration) {
    parts.push(turn.rollNarration);
  }
  
  if (turn.hpChanges && turn.hpChanges.length > 0) {
    const hpTexts = turn.hpChanges
      .map(c => {
        if (c.change < 0) {
          return `${c.characterName} lost ${Math.abs(c.change)} H P.`;
        } else if (c.change > 0) {
          return `${c.characterName} gained ${c.change} H P.`;
        }
        return '';
      })
      .filter(Boolean);
    if (hpTexts.length > 0) {
      parts.push(hpTexts.join(' '));
    }
  }
  
  return sanitizeText(parts.join(' '));
}

/**
 * Builds the narration segment.
 */
export function buildNarrationSegment(turn: TurnResult): string {
  return sanitizeText(turn.narration || '');
}

/**
 * Builds the encounter boundary announcement.
 */
export function buildEncounterBoundarySegment(
  prevStatus: 'none' | 'active' | 'defeated' | 'fled' | 'surrendered' | 'resolved' | string,
  currentStatus: 'none' | 'active' | 'defeated' | 'fled' | 'surrendered' | 'resolved' | string,
  encounterName?: string,
  resolution?: string
): string {
  if (prevStatus !== 'active' && currentStatus === 'active') {
    return sanitizeText(`Encounter started. ${encounterName || ''}`);
  }
  if (prevStatus === 'active' && currentStatus !== 'active' && currentStatus !== 'none') {
    return sanitizeText(`Encounter finished. ${resolution || ''}`);
  }
  return '';
}

/**
 * Builds active character and class readout.
 */
export function buildActiveCharacterSegment(session: Session): string {
  const activeChar = session.party.find(c => c.id === session.activeCharacterId);
  if (!activeChar) {
    return '';
  }
  return sanitizeText(`It is ${activeChar.name}'s move. They are a ${activeChar.class}.`);
}

/**
 * Builds options segment.
 */
export function buildChoicesSegment(choices: Choice[]): string {
  if (!choices || choices.length === 0) {
    return '';
  }
  return choices.map((c, i) => sanitizeText(`Option ${i + 1}: ${c.label}.`)).join(' ');
}

/**
 * Builds gear/inventory readout, active character first, then the rest.
 */
export function buildGearSegment(session: Session): string {
  const activeChar = session.party.find(c => c.id === session.activeCharacterId);
  const otherChars = session.party.filter(c => c.id !== session.activeCharacterId);
  
  const parts: string[] = [];
  
  const readCharInventory = (char: Character, isActive: boolean) => {
    const intro = isActive 
      ? `Your character, ${char.name}, has the following items:` 
      : `${char.name} has the following items:`;
    if (!char.inventory || char.inventory.length === 0) {
      return `${intro} no items.`;
    }
    const itemLines = char.inventory.map(item => {
      const effectText = item.effect ? `, effect: ${item.effect}` : '';
      return `${item.name}. ${item.description}${effectText}`;
    });
    return `${intro} ${itemLines.join('. ')}.`;
  };

  if (activeChar) {
    parts.push(readCharInventory(activeChar, true));
  }
  for (const char of otherChars) {
    parts.push(readCharInventory(char, false));
  }
  
  return sanitizeText(parts.join(' '));
}

/**
 * Builds status readout.
 */
export function buildStatusSegment(session: Session, expectedInput: string): string {
  const activeChar = session.party.find(c => c.id === session.activeCharacterId);
  const encounterActive = session.encounterState?.status === 'active';
  const hpText = activeChar ? `, with ${activeChar.hp} of ${activeChar.max_hp} H P` : '';
  const sceneText = `Current scene is ${session.scene}.`;
  const characterText = activeChar ? `Active character is ${activeChar.name}${hpText}.` : '';
  const encounterText = encounterActive ? `An encounter is active: ${session.encounterState?.name}.` : 'No active encounter.';
  return sanitizeText(`${sceneText} ${characterText} ${encounterText} Expected input is: ${expectedInput}`);
}

/**
 * Builds party HP/status readout.
 */
export function buildPartySegment(session: Session): string {
  const partyLines = session.party.map(c => {
    const statusText = c.status === 'downed' ? 'is downed' : 'is active';
    return `${c.name}, ${c.class}, has ${c.hp} of ${c.max_hp} H P and ${statusText}.`;
  });
  return sanitizeText(`Party status: ${partyLines.join(' ')}`);
}

/**
 * Builds location readout.
 */
export function buildLocationSegment(session: Session, latestTurn?: TurnResult): string {
  const locationText = `We are at: ${session.scene}.`;
  const narrationText = latestTurn?.narration ? `The situation is: ${latestTurn.narration}` : '';
  return sanitizeText(`${locationText} ${narrationText}`);
}

// Cachable static prompts
export const CHOOSE_ACTION_PROMPT = "What do you do? Say option one, two, three, or say a custom action.";
export const CONFIRM_ACTION_PROMPT = "Say confirm, cancel, or try again.";
export const HELP_TEXT = "Voice commands: options, repeat story, status, party, gear, where are we, pause, resume, cancel, confirm, or say an option number.";
