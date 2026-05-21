export const HEALING_ACTION_RE = /\b(heal|healing|restore|restoring|revive|reviving|mend|mending|soothe|soothing|recover|recovery|rest|resting|sleep|sleeping|eat|eating|meal|care|treat|treating|medicine|potion|bandage|sanctuary)\b/i;

export const searchable = (text: string | undefined): string => (text ?? '')
  .toLowerCase()
  .normalize('NFKD')
  .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
  .replace(/\s+/g, ' ')
  .trim();

export const containsSearchable = (haystack: string, needle: string | undefined): boolean => {
  const normalizedNeedle = searchable(needle);
  return normalizedNeedle.length > 1 && haystack.includes(normalizedNeedle);
};
