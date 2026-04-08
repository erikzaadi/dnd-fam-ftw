import type { TurnResult, Choice, Character } from '../../types';

interface ActionControlsProps {
  lastTurn: TurnResult | null;
  loading: boolean;
  onSubmit: (label: string, stat: string, diff: string) => void;
  customAction: string;
  setCustomAction: (action: string) => void;
  activeCharacter: Character | null;
  disabled?: boolean;
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

export const ActionControls = ({ lastTurn, loading, onSubmit, customAction, setCustomAction, activeCharacter, disabled }: ActionControlsProps) => {
  const isActionTaken = !!lastTurn?.lastAction;
  const takenAction = lastTurn?.lastAction?.actionAttempt || "";
  
  // If disabled (past turn), use character from the lastAction if available
  const displayCharacter = !disabled ? activeCharacter : (lastTurn?.lastAction ? activeCharacter : activeCharacter); 
  // Wait, if lastTurn has history, we should have the character that took that action.
  // The current TurnResult interface doesn't store character info, so we may need to assume 
  // the 'activeCharacter' is sufficient or update the interface if needed.
  // For now, sticking to activeCharacter display is safest, but we can refine if character info is added to TurnResult.

  return (
    <div className="flex gap-6 p-6 bg-slate-900/50 rounded-[40px] border border-slate-800">
      <div className="flex flex-col items-center gap-3 w-32 shrink-0">
        <img src={displayCharacter?.avatarUrl || '/api/images/default_scene.png'} className="w-20 h-20 rounded-2xl object-cover border-2 border-amber-500" />
        <span className="font-black text-xs uppercase tracking-widest">{displayCharacter?.name}</span>
      </div>

      <div className="flex-grow space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {lastTurn?.choices.map((choice: Choice, i: number) => (
            <button 
                key={i} 
                onClick={() => onSubmit(choice.label, choice.stat, choice.difficulty)} 
                disabled={loading || disabled} 
                className={`p-4 rounded-2xl border-2 text-xs font-black uppercase transition-all 
                  ${isActionTaken && choice.label === takenAction ? 'border-amber-400 bg-amber-500/20' : STAT_COLORS[choice.stat]} 
                  ${DIFF_COLORS[choice.difficulty]} hover:scale-105 disabled:opacity-50`}
            >
                {choice.label}
                <div className="text-[10px] opacity-70 mt-1">{choice.stat} ({choice.difficulty})</div>
            </button>
          ))}
        </div>
        <div className="flex gap-4">
            <input 
                value={isActionTaken && !lastTurn?.choices.length ? takenAction : customAction}
                onChange={(e) => setCustomAction(e.target.value)}
                disabled={disabled}
                className="flex-grow p-4 bg-slate-800 rounded-xl disabled:opacity-50"
                placeholder="What do you do?"
            />
            <button onClick={() => onSubmit(customAction, 'none', 'normal')} disabled={loading || disabled} className="px-8 py-4 bg-amber-600 rounded-xl font-black uppercase disabled:opacity-50">UNLEASH</button>
        </div>
      </div>
    </div>
  );
};