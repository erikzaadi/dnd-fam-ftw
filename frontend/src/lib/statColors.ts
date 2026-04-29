/** Shared border/background/text color classes keyed by stat name. */
export const STAT_COLORS: Record<string, string> = {
  might: 'border-rose-500/50 bg-rose-950/20 text-rose-300',
  magic: 'border-blue-500/50 bg-blue-950/20 text-blue-300',
  mischief: 'border-purple-500/50 bg-purple-950/20 text-purple-300',
  none: 'border-slate-600 bg-slate-900 text-slate-300',
};

/** Text-only color per stat for inline labels and numbers. */
export const STAT_TEXT_COLORS: Record<string, string> = {
  might: 'text-rose-400',
  magic: 'text-blue-400',
  mischief: 'text-purple-400',
};
