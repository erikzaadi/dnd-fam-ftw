const TANK_CLASS_PATTERNS = [
  /\bbarbarian\b/i,
  /\bberserker\b/i,
  /\bfighter\b/i,
  /\bwarrior\b/i,
  /\bpaladin\b/i,
  /\bdeath\s*knight\b/i,
  /\bknight\b/i,
  /\bcrusader\b/i,
  /\bguardian\b/i,
  /\btank\b/i,
];

export function getStartingMaxHp(characterClass: string): number {
  return TANK_CLASS_PATTERNS.some(pattern => pattern.test(characterClass)) ? 12 : 10;
}
