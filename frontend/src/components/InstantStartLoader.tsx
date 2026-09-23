import { useEffect, useState } from 'react';
import { imgSrc } from '../lib/api';

const PUNS = [
  'Consulting the ancient dice...',
  'Bribing the dungeon master...',
  'Rolling for destiny...',
  'Assembling a suspiciously willing party...',
  'Arguing about who gets the good sword...',
  'The tavern notice board has been consulted...',
  'Politely waking the sleeping dragon...',
  'Negotiating with fate (fate is driving a hard bargain)...',
  'Checking if the map is upside down...',
  'The prophecy is being speed-read...',
  'Someone forgot to bring torches. Again.',
  'Debating whether goblins count as a warm-up...',
  'Asking the skeleton if it has a bone to pick...',
  'Convincing the bard this is not a solo campaign...',
  'Putting the romance in necromancer...',
  'Teaching the gelatinous cube to think outside the box...',
  'Reminding the rogue that sharing is not a sleight of hand...',
  'Waiting for the wizard to finish a spell check...',
  'Telling the paladin to lighten up. Literally.',
  'Helping the druid get to the root of the problem...',
  'Asking the barbarian to use their indoor roar...',
  'Checking the chest for teeth...',
  'Checking the teeth for treasure...',
  'Explaining to the mimic that this is a closed-door meeting...',
  'Giving the dragon a stern hoarding...',
  'Making sure the lich has a life outside work...',
  'Asking the cleric for a little divine inter-venting...',
  'Rolling for initiative. Losing to the furniture.',
  'Debating whether a fireball counts as a doorbell...',
  'Filing a noise complaint against the thunder spell...',
  'Trying to get the party on the same side quest...',
  'Arguing about who gets the slightly worse sword...',
  'Convincing the fighter that every problem is not a nail...',
  'Asking the warlock to read the terms and conditions...',
  'Giving the ranger some space. About 120 feet.',
  'Untangling the plot hooks from the fishing gear...',
  'Taking the dungeon decor for granite...',
  'Asking the golem to be a little boulder...',
  'Making the troll pay the bridge toll. How the turns table.',
  'Putting the loot in absolutely not a mimic...',
  'Checking whether emotional baggage fits in a bag of holding...',
  'Persuading the dice that one is not the only number...',
  'Rehearsing a heroic entrance. Tripping on the cape.',
  'Explaining that stealth is not yelling quietly...',
  'Waiting for the monk to punch in...',
  'Taking a short rest from planning the long rest...',
  'Asking the beholder to keep an eye out. Just one.',
  'Finding out who used the quest map as a napkin...',
];

const CYCLE_MS = 4500;

export const InstantStartLoader = () => {
  const [punIndex, setPunIndex] = useState(() => Math.floor(Math.random() * PUNS.length));

  useEffect(() => {
    const interval = setInterval(() => {
      setPunIndex(i => (i + 1) % PUNS.length);
    }, CYCLE_MS);
    return () => clearInterval(interval);
  }, []);

  return (
    <div data-testid="instant-start-loader" className="fixed inset-0 z-50 bg-slate-950/90 flex items-center justify-center px-6">
      {/* Popup card */}
      <div className="relative w-full max-w-md overflow-hidden rounded-[32px] border border-slate-700/60 shadow-2xl">
        {/* dm_thinking background with ken burns */}
        <img
          src={imgSrc('/images/dm_thinking.png')}
          className="absolute inset-0 w-full h-full object-cover animate-ken-burns"
          alt=""
        />
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/60 to-slate-950/30" />

        {/* Content */}
        <div className="relative flex flex-col items-center gap-6 px-8 py-12">
          <img
            src={imgSrc('/images/icon_dice.png')}
            className="w-20 h-20 rounded-full object-cover animate-spin"
            style={{ animationDuration: '3s' }}
            alt=""
          />
          <div className="text-center">
            <p className="text-amber-400 font-black uppercase italic tracking-tighter text-2xl md:text-3xl mb-3">
              Fate is deciding...
            </p>
            <p className="text-slate-300 text-base font-medium transition-all duration-500 min-h-[1.5rem]">
              {PUNS[punIndex]}
            </p>
          </div>
          <p className="text-slate-500 text-sm">This may take a moment while your realm is conjured</p>
        </div>
      </div>
    </div>
  );
};
