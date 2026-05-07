export const RANDOM_NAMES: string[] = [
  // Gruff/warrior
  'Cohen', 'Cargath', 'Gorrak', 'Broxxar', 'Durogg', 'Grubnok', 'Thrumbar', 'Orgnak', 'Grimtusk', 'Varrok', 'Bolgur', 'Thrull',
  // Elven/mystical
  'Sylvara', 'Malfyn', 'Tyraeth', 'Elunarra', 'Illindra', 'Aranith', 'Vashara', 'Thessaly', 'Luneth', 'Caelindra',
  // Pratchett-esque
  'Rinsworth', 'Weathergrym', 'Ogglesworth', 'Vettinar', 'Carrotson', 'Angwald', 'Vymeson', 'Tiffwick', 'Dethsworth', 'Patchwick',
  // Troll-flavoured
  'Zulrokk', 'Vohljin', 'Rokshan', 'Jinzara', 'Zaltok', 'Hexnar', 'Bwonshy', 'Mossgrin',
  // Undead-appropriate
  'Gothwyn', 'Faranell', 'Putwick', 'Mortessa', 'Sylvagrim', 'Grimbane', 'Rotwick', 'Lichsworth', 'Licorice King', 'Grimoire Jones',
  // Tauren-appropriate
  'Hamuun', 'Baynecrest', 'Cairnhorn', 'Eytrig', 'Stonehoof', 'Thundermere', 'Plainwalker', 'Grasstread',
  // Gnome/small folk
  'Pip', 'Nixie', 'Cobb', 'Sprocket', 'Tinwhistle', 'Gizwick', 'Fumblefingers', 'Cogsworth', 'Wobblehat',
];

export const RANDOM_SPECIES: string[] = [
  'Human', 'Elf', 'Dwarf', 'Halfling', 'Gnome', 'Half-Orc', 'Tiefling',
  'Dragonborn', 'Aasimar', 'Tabaxi', 'Tauren', 'Orc', 'Troll', 'Undead',
];

export const RANDOM_CLASSES: string[] = [
  'Fighter', 'Paladin', 'Barbarian', 'Cleric', 'Druid', 'Bard',
  'Rogue', 'Ranger', 'Wizard', 'Warlock', 'Sorcerer',
];

export const RANDOM_QUIRKS: string[] = [
  'Insists every meal is a "victory feast" regardless of what just happened',
  'Narrates their own actions in third person under their breath',
  'Cannot resist petting any animal, including hostile ones',
  'Keeps a journal of every door they have opened',
  'Whispers "classic" whenever something goes wrong',
  'Gives elaborate names to every sword they pick up, even borrowed ones',
  'Refuses to walk through puddles on principle',
  'Dramatically rolls a coin before every decision, then ignores the result',
  'Collects rocks from every location and names them after friends',
  'Refers to all enemies as "that rascal" regardless of how terrifying they are',
  'Insists on knocking before entering any dungeon room',
  'Hums battle hymns slightly off-key during combat',
  'Takes meticulous notes that are entirely illegible',
  'Cannot say goodbye without a formal speech',
  'Gives unsolicited opinions on everyone\'s combat stance',
  'Sneezes whenever they sense magic nearby',
  'Insists on translating everything into a dramatic poem after the fact',
  'Has strong opinions about which taverns have the best ambience',
  'Refuses to be the first one through any door',
  'Always bows to skeletons out of "professional respect"',
];

export function pickRandom<T>(pool: T[], exclude: T[] = []): T {
  const available = pool.filter(item => !exclude.includes(item));
  if (available.length === 0) {
    throw new Error('No items left in pool after exclusions');
  }
  return available[Math.floor(Math.random() * available.length)];
}
