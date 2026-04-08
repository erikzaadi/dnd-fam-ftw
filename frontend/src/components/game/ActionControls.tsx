import type { TurnResult, Choice, Character } from '../../types';

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
  if (might > magic && might > mischief) return 'might';
  if (magic > might && magic > mischief) return 'magic';
  return 'mischief';
};

export const ActionControls = ({ turn, loading, onSubmit, customAction, setCustomAction, activeCharacter }: ActionControlsProps) => (
    <div className="flex gap-6 p-6 bg-slate-900/50 rounded-[40px] border border-slate-800">
      <div className="flex flex-col items-center gap-2 w-32 shrink-0">
        <img src={activeCharacter?.avatarUrl || '/api/images/default_scene.png'} className="w-20 h-20 rounded-2xl object-cover border-2 border-amber-500" />
        <span className="font-black text-xs uppercase tracking-widest text-center">{activeCharacter?.name}</span>
        {activeCharacter && (
          <div className="text-center space-y-0.5">
            <div className="text-[9px] text-slate-400 uppercase tracking-wide">{activeCharacter.class} · {activeCharacter.species}</div>
            <div className="text-[9px] text-amber-500 font-black">{activeCharacter.hp}/{activeCharacter.max_hp} HP</div>
          </div>
        )}
      </div>

      <div className="flex-grow space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {turn?.choices.map((choice: Choice, i: number) => (
            <button
              key={i}
              onClick={() => onSubmit(choice.label, choice.stat, choice.difficulty)}
              disabled={loading}
              className={`p-4 rounded-2xl border-2 text-sm font-black uppercase transition-all flex flex-col items-center justify-between min-h-[80px]
                ${STAT_COLORS[choice.stat]} ${DIFF_COLORS[choice.difficulty]} hover:scale-105 disabled:opacity-50`}
            >
              <span className="leading-tight text-center">{choice.label}</span>
              <span className={`text-[9px] font-black tracking-widest px-2 py-0.5 rounded-full opacity-80
                ${choice.stat === 'might' ? 'bg-rose-900/60' : choice.stat === 'magic' ? 'bg-blue-900/60' : 'bg-purple-900/60'}`}>
                {choice.stat} · {choice.difficulty}
              </span>
            </button>
          ))}
        </div>
        <div className="flex gap-4">
          <input
            value={customAction}
            onChange={(e) => setCustomAction(e.target.value)}
            className="flex-grow p-4 bg-slate-800 rounded-xl"
            placeholder="What do you do?"
          />
          <button onClick={() => onSubmit(customAction, deriveStatFromText(customAction), 'normal')} disabled={loading} className="px-8 py-4 bg-amber-600 rounded-xl font-black uppercase disabled:opacity-50">UNLEASH</button>
        </div>
      </div>
    </div>
);
