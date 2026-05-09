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
];

const CYCLE_MS = 4500;

export const InstantStartLoader = () => {
  const [punIndex, setPunIndex] = useState(0);

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
