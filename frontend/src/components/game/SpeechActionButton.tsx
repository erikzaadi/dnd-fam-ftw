import { Tooltip } from '../Tooltip';

type SpeechActionButtonProps = {
  enabled: boolean;
  supported: boolean;
  active: boolean;
  disabled: boolean;
  errorMessage: string | null;
  onClick: () => void;
};

export const SpeechActionButton = ({
  enabled,
  supported,
  active,
  disabled,
  errorMessage,
  onClick,
}: SpeechActionButtonProps) => {
  if (!enabled) {
    return null;
  }

  const unavailable = !supported;
  const message = unavailable ? 'Speech input is not supported in this browser.' : errorMessage;
  const tooltip = message ?? (active ? 'Listening... (click to stop)' : 'Voice action (V)');

  return (
    <div className="absolute -top-3 -right-3 z-10">
      <Tooltip content={tooltip} position="top" align="right" as="div">
        <button
          type="button"
          onClick={onClick}
          disabled={disabled || unavailable}
          aria-label="Start voice action"
          className={`w-8 h-8 flex items-center justify-center rounded-full border-2 text-base shadow-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
            active
              ? 'bg-emerald-900 border-emerald-500 animate-pulse'
              : 'bg-slate-800 hover:bg-slate-700 border-slate-600 hover:border-amber-500/60'
          }`}
        >
          🎤
        </button>
      </Tooltip>
    </div>
  );
};

