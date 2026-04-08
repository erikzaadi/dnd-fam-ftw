import type { TurnResult } from '../../types';

interface NarrationProps {
  history: TurnResult[];
  loading: boolean;
  onTurnClick: (i: number) => void;
  viewedTurnIdx: number;
}

export const Narration = ({ history, loading, onTurnClick, viewedTurnIdx }: NarrationProps) => (
  <div className="bg-slate-900 rounded-[50px] border border-slate-800 shadow-2xl h-[600px] flex flex-col relative overflow-hidden">
    <div className="flex-grow p-10 space-y-6 overflow-y-auto">
      {history.map((turn, i) => (
        <button key={i} onClick={() => onTurnClick(i)} className={`text-left p-6 rounded-3xl transition-all flex gap-4 ${viewedTurnIdx === i ? 'bg-amber-500/10' : ''}`}>
          {turn.lastAction && (
              <div className="shrink-0 flex flex-col items-center gap-2">
                  <img src={turn.imageUrl || '/api/images/default_scene.png'} className="w-12 h-12 rounded-full object-cover border border-slate-700" alt="Action" />
                  <span className="text-[9px] font-black uppercase text-slate-500">Action</span>
              </div>
          )}
          <p className="text-lg text-slate-300 leading-relaxed">{turn.narration}</p>
        </button>
      ))}
      {loading && <div className="p-6 text-amber-500 animate-pulse">DM is narrating...</div>}
    </div>
  </div>
);
