import { RANDOM_NAMES, RANDOM_SPECIES, RANDOM_QUIRKS, pickRandom } from '@dnd-fam-ftw/shared';

type Role = 'tank' | 'healer' | 'damage';

export interface PartyArchetype {
  class: string;
  role: Role;
  stats: { might: number; magic: number; mischief: number };
  maxHp: number;
  name: string;
  species: string;
  quirk: string;
}

const ARCHETYPES: Omit<PartyArchetype, 'name' | 'species' | 'quirk'>[] = [
  { class: 'Fighter',   role: 'tank',   stats: { might: 5, magic: 1, mischief: 1 }, maxHp: 12 },
  { class: 'Paladin',   role: 'tank',   stats: { might: 4, magic: 2, mischief: 1 }, maxHp: 12 },
  { class: 'Barbarian', role: 'tank',   stats: { might: 5, magic: 1, mischief: 2 }, maxHp: 12 },
  { class: 'Cleric',    role: 'healer', stats: { might: 2, magic: 4, mischief: 1 }, maxHp: 10 },
  { class: 'Druid',     role: 'healer', stats: { might: 1, magic: 5, mischief: 1 }, maxHp: 10 },
  { class: 'Bard',      role: 'healer', stats: { might: 1, magic: 3, mischief: 3 }, maxHp: 10 },
  { class: 'Rogue',     role: 'damage', stats: { might: 2, magic: 1, mischief: 5 }, maxHp: 10 },
  { class: 'Ranger',    role: 'damage', stats: { might: 3, magic: 1, mischief: 4 }, maxHp: 10 },
  { class: 'Wizard',    role: 'damage', stats: { might: 1, magic: 5, mischief: 1 }, maxHp: 10 },
  { class: 'Warlock',   role: 'damage', stats: { might: 2, magic: 4, mischief: 2 }, maxHp: 10 },
  { class: 'Sorcerer',  role: 'damage', stats: { might: 1, magic: 5, mischief: 1 }, maxHp: 10 },
];

export interface WorldSeed {
  displayName: string;
  worldDescription: string;
}

export const WORLD_SEEDS: WorldSeed[] = [
  { displayName: 'The Crumbling Imperium',    worldDescription: 'A realm of failing empires, where emperors argue over maps of lands they no longer control and the tax collectors are more feared than the monsters.' },
  { displayName: 'The Wildmagic Wastes',      worldDescription: 'A land where magic erupts randomly, turning forests into cathedrals overnight and occasionally converting mountains into something much more inconvenient.' },
  { displayName: 'The Forgetting Sea',        worldDescription: 'A world where memory is currency, the most dangerous person in any room is a wizard who remembers everything, and the banks are very suspicious.' },
  { displayName: 'The Borrowed Crown',        worldDescription: 'A kingdom with seventeen claimants to a throne that most people quietly agree is not worth the trouble, yet everyone keeps fighting over anyway.' },
  { displayName: 'The Sleepless Lands',       worldDescription: 'A world where no one has dreamed for a hundred years. The reason is something very old, very hungry, and currently pretending to be a hill.' },
  { displayName: 'The Last Warm Place',       worldDescription: 'A frozen realm where all remaining civilization huddles around a single volcano. The rent is astronomical and the landlord is a dragon who insists she is being reasonable.' },
  { displayName: 'The Upside Kingdom',        worldDescription: 'A land built on the underside of a floating continent, where everything falls upward, the sky is a floor, and navigation is mostly a matter of confidence.' },
  { displayName: 'The Patchwork Realms',      worldDescription: 'A world stitched together from pieces of other worlds, where the borders shift every fortnight and no one can agree on what counts as trespassing.' },
  { displayName: 'The Grand Misunderstanding', worldDescription: 'A realm still dealing with the consequences of a prophecy that was misread two hundred years ago. Everyone involved is too embarrassed to bring it up.' },
  { displayName: 'The Merchant Republic',     worldDescription: 'A world run entirely by a merchant guild that accidentally achieved godhood during a hostile takeover. They are very uncomfortable about it and keep issuing disclaimers.' },
  { displayName: 'The Second Age of Heroes',  worldDescription: 'The first age of heroes went rather badly. The second age has lower expectations, better insurance, and a strict policy on collateral damage.' },
  { displayName: 'The Living Dungeon',        worldDescription: 'A world where the dungeons are alive, opinionated, and have strong feelings about adventurers tracking mud through their carefully laid corridors.' },
];

export function pickWorldSeed(): WorldSeed {
  return pickRandom(WORLD_SEEDS);
}

export function pickRandomPartyArchetypes(): PartyArchetype[] {
  const byRole = (role: Role) => ARCHETYPES.filter(a => a.role === role);

  const tank   = pickRandom(byRole('tank'));
  const healer = pickRandom(byRole('healer'));
  const damage = pickRandom(byRole('damage'));

  const mandatory = [tank, healer, damage];
  const partySize = 3 + Math.floor(Math.random() * 3); // 3-5
  const extras: typeof ARCHETYPES[0][] = [];

  if (partySize > 3) {
    const usedClasses = new Set(mandatory.map(a => a.class));
    const remaining = ARCHETYPES.filter(a => !usedClasses.has(a.class));
    for (let i = 0; i < partySize - 3 && i < remaining.length; i++) {
      const pick = pickRandom(remaining.filter(a => !extras.includes(a)));
      extras.push(pick);
    }
  }

  const usedNames: string[] = [];
  const usedQuirks: string[] = [];

  return [...mandatory, ...extras].map(archetype => {
    const name = pickRandom(RANDOM_NAMES, usedNames);
    usedNames.push(name);
    const species = pickRandom(RANDOM_SPECIES);
    const quirk = pickRandom(RANDOM_QUIRKS, usedQuirks);
    usedQuirks.push(quirk);
    return { ...archetype, name, species, quirk };
  });
}
