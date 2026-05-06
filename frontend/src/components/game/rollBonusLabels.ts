export const formatHelperBonusLabel = (bonus: number, helperCharacterName?: string): string =>
  `${bonus} help${helperCharacterName ? ` (${helperCharacterName.split(' ')[0]})` : ''}`;

const splitItemEmojiAndName = (choiceItemName: string | undefined): { emoji: string | null; shortName: string | null } => {
  if (!choiceItemName) {
    return { emoji: null, shortName: null };
  }
  const [firstChar] = Array.from(choiceItemName.trim());
  const hasEmoji = !!firstChar && /\p{Extended_Pictographic}/u.test(firstChar);
  const nameWithoutEmoji = hasEmoji
    ? choiceItemName.trim().slice(firstChar.length).trim()
    : choiceItemName.trim();
  return {
    emoji: hasEmoji ? firstChar : null,
    shortName: nameWithoutEmoji ? nameWithoutEmoji.split(' ')[0] : null,
  };
};

export const formatChoiceItemBonusLabel = (bonus: number, choiceItemName?: string): string => {
  const { emoji, shortName } = splitItemEmojiAndName(choiceItemName);
  const itemLabel = [emoji, shortName].filter(Boolean).join(' ');
  return `${bonus} gear${itemLabel ? ` (${itemLabel})` : ''}`;
};

export const formatCharacterBonusLabel = (bonus: number, characterBonusLabel?: string): string =>
  `${bonus} ${characterBonusLabel ?? 'edge'}`;
