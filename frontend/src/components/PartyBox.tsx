import type { Character } from '../types';
import { imgSrc, pulseSyncDelay } from '../lib/api';

interface PartyBoxProps {
  party: Character[];
  activeCharacterId: string;
  onCharacterClick: (c: Character) => void;
}

export const PartyBox = ({ party, activeCharacterId, onCharacterClick }: PartyBoxProps) => (
  <div className="flex items-center gap-2 bg-slate-900/50 p-3 rounded-full border border-slate-800 shadow-xl">
    <div className="flex gap-2">
      {party.map(c => (
        <div key={c.id} className="relative group">
          <img
            src={imgSrc(c.avatarUrl)}
            onClick={() => onCharacterClick(c)}
            className={`w-12 h-12 rounded-full object-cover cursor-pointer border-2 transition-all hover:scale-110 ${c.status === 'downed' ? 'grayscale opacity-40 border-slate-700' : c.id === activeCharacterId ? 'border-amber-500 animate-border-pulse' : 'border-slate-800'}`}
            style={c.id === activeCharacterId && c.status !== 'downed' ? { animationDelay: pulseSyncDelay() } : undefined}
            alt={c.name}
          />
          {c.status === 'downed' && (
            <div className="absolute inset-0 flex items-center justify-center rounded-full pointer-events-none">
              <span className="text-lg">💀</span>
            </div>
          )}
          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-xl text-[10px] font-black uppercase tracking-widest text-white shadow-xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap">
            {c.name}{c.status === 'downed' ? ' · DOWNED' : ''}
            <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-700" />
          </div>
        </div>
      ))}
    </div>
  </div>
);
