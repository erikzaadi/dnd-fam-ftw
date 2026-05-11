import type { Character } from '../types';

export type CharacterPresetId =
  | 'physical'
  | 'ranged'
  | 'magical'
  | 'healer'
  | 'tank'
  | 'bard'
  | 'manual';

export type CharacterPreset = {
  id: CharacterPresetId;
  label: string;
  description: string;
  values: {
    class: string;
    species: string;
    quirk: string;
    stats: Character['stats'];
  } | null;
};

export const CHARACTER_PRESETS: CharacterPreset[] = [
  {
    id: 'physical',
    label: 'Blade Hero',
    description: 'Front-line striker with big swings and brave charges.',
    values: {
      class: 'Knight',
      species: 'Human',
      quirk: 'Charges into danger with a heroic grin',
      stats: { might: 5, magic: 1, mischief: 1 },
    },
  },
  {
    id: 'ranged',
    label: 'Sharpshot',
    description: 'Quick, sneaky, and excellent from a safe distance.',
    values: {
      class: 'Ranger',
      species: 'Halfling',
      quirk: 'Can spot a tiny clue from across the room',
      stats: { might: 2, magic: 1, mischief: 4 },
    },
  },
  {
    id: 'magical',
    label: 'Spell Slinger',
    description: 'A bright arcane problem-solver with dramatic sparks.',
    values: {
      class: 'Wizard',
      species: 'Elf',
      quirk: 'Whispers to glowing spellbook pages',
      stats: { might: 1, magic: 5, mischief: 1 },
    },
  },
  {
    id: 'healer',
    label: 'Light Keeper',
    description: 'A caring support hero with useful magic.',
    values: {
      class: 'Cleric',
      species: 'Human',
      quirk: 'Carries lucky bandages and kind words',
      stats: { might: 2, magic: 4, mischief: 1 },
    },
  },
  {
    id: 'tank',
    label: 'Shield Bearer',
    description: 'Sturdy protector who stands between friends and trouble.',
    values: {
      class: 'Guardian',
      species: 'Dwarf',
      quirk: 'Names every shield dent after a victory',
      stats: { might: 4, magic: 2, mischief: 1 },
    },
  },
  {
    id: 'bard',
    label: 'Story Singer',
    description: 'Talks, performs, distracts, and turns chaos into a plan.',
    values: {
      class: 'Bard',
      species: 'Gnome',
      quirk: 'Makes up theme songs for everyone',
      stats: { might: 1, magic: 2, mischief: 4 },
    },
  },
  {
    id: 'manual',
    label: 'Manual',
    description: 'Start blank or use the rolled suggestion.',
    values: null,
  },
];
