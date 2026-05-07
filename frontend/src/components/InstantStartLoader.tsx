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
    <div data-testid="instant-start-loader" className="fixed inset-0 z-50 bg-slate-950/95 flex flex-col items-center justify-center gap-8 px-6">
      <img
        src={imgSrc('/images/icon_dice.png')}
        className="w-24 h-24 rounded-full object-cover animate-spin"
        style={{ animationDuration: '3s' }}
        alt=""
      />
      <div className="text-center">
        <p className="text-amber-400 font-black uppercase italic tracking-tighter text-2xl md:text-4xl mb-3">
          Fate is deciding...
        </p>
        <p className="text-slate-300 text-lg md:text-xl font-medium transition-all duration-500 min-h-[2rem]">
          {PUNS[punIndex]}
        </p>
      </div>
      <p className="text-slate-600 text-sm">This may take a moment while your realm is conjured</p>
    </div>
  );
};
