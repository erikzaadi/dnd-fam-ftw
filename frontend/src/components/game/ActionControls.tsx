import type { TurnResult, Choice, Character } from '../../types';
import { imgSrc, pulseSyncDelay } from '../../lib/api';

interface ActionControlsProps {
  turn: TurnResult | null;
  loading: boolean;
  onSubmit: (label: string, stat: string, diff: string) => void;
  customAction: string;
  setCustomAction: (action: string) => void;
  activeCharacter: Character | null;
}

const STAT_COLORS: Record<string, string> = {
  might: 'border-rose-500 bg-rose-950/30 text-rose-200',
  magic: 'border-blue-500 bg-blue-950/30 text-blue-200',
  mischief: 'border-purple-500 bg-purple-950/30 text-purple-200',
  none: 'border-slate-500 bg-slate-900 text-slate-200'
};

const DIFF_COLORS: Record<string, string> = {
  easy: 'shadow-[inset_0_0_10px_rgba(34,197,94,0.3)]',
  normal: 'shadow-[inset_0_0_10px_rgba(245,158,11,0.3)]',
  hard: 'shadow-[inset_0_0_10px_rgba(239,68,68,0.3)]'
};

const deriveStatFromText = (text: string): 'might' | 'magic' | 'mischief' => {
  const t = text.toLowerCase();
  const score = (words: string[]) => words.filter(w => t.includes(w)).length;
  const might    = score(['attack','fight','strike','punch','kick','push','break','smash','climb','jump','charge','block','lift','throw','force','grab','wrestle','run','bash','slay']);
  const magic    = score(['cast','spell','magic','enchant','summon','hex','curse','charm','heal','teleport','conjure','arcane','ritual','invoke','divine','mystic','ward','channel','manifest']);
  const mischief = score(['sneak','steal','trick','deceive','hide','distract','bluff','lie','pickpocket','disguise','bribe','scheme','persuade','mock','taunt','distract','lure','outsmart','con']);
  if (might > magic && might > mischief) {
    return 'might';
  }
  if (magic > might && magic > mischief) {
    return 'magic';
  }
  return 'mischief';
};

export const ActionControls = ({ turn, loading, onSubmit, customAction, setCustomAction, activeCharacter }: ActionControlsProps) => (
  <div className="flex flex-col gap-4 p-4 md:p-6 bg-slate-900/50 rounded-[40px] border border-slate-800">
    {/* Character row */}
    <div className="flex items-center gap-3">
      <img src={imgSrc(activeCharacter?.avatarUrl)} className="w-12 h-12 rounded-2xl object-cover border-2 border-amber-500 animate-border-pulse shrink-0" style={{ animationDelay: pulseSyncDelay() }} />
      {activeCharacter && (
        <div>
          <div className="font-black text-xs uppercase tracking-widest">{activeCharacter.name}</div>
          <div className="text-[9px] text-slate-400 uppercase tracking-wide">{activeCharacter.class} · {activeCharacter.species}</div>
          <div className="text-[9px] text-amber-500 font-black">{activeCharacter.hp}/{activeCharacter.max_hp} HP</div>
        </div>
      )}
    </div>

    {/* Choices */}
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-3 min-w-0">
      {turn?.choices.map((choice: Choice, i: number) => (
        <button
          key={i}
          onClick={() => onSubmit(choice.label, choice.stat, choice.difficulty)}
          disabled={loading}
          className={`w-full min-w-0 overflow-hidden p-4 rounded-2xl border-2 text-sm font-black uppercase transition-all flex flex-col items-center justify-between min-h-[80px]
              ${STAT_COLORS[choice.stat]} ${DIFF_COLORS[choice.difficulty]} hover:scale-105 disabled:opacity-50`}
        >
          <span className="leading-tight text-center break-words w-full">{choice.label}</span>
          <span className={`text-[9px] font-black tracking-widest px-2 py-0.5 rounded-full opacity-80 mt-1 shrink-0
              ${choice.stat === 'might' ? 'bg-rose-900/60' : choice.stat === 'magic' ? 'bg-blue-900/60' : 'bg-purple-900/60'}`}>
            {choice.stat} · {choice.difficulty}
          </span>
        </button>
      ))}
    </div>

    {/* Custom action */}
    <div className="flex gap-3">
      <input
        value={customAction}
        onChange={(e) => setCustomAction(e.target.value)}
        className="flex-1 min-w-0 p-4 bg-slate-800 rounded-xl"
        placeholder="What do you do?"
      />
      <button onClick={() => onSubmit(customAction, deriveStatFromText(customAction), 'normal')} disabled={loading} className="shrink-0 px-6 py-4 bg-amber-600 rounded-xl font-black uppercase disabled:opacity-50">UNLEASH</button>
    </div>
  </div>
);
