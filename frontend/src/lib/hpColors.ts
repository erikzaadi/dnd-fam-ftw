/** Returns Tailwind color classes for HP bar and HP text based on current/max HP. */
export const getHpColors = (hp: number, maxHp: number): { bar: string; text: string } => {
  const pct = maxHp > 0 ? hp / maxHp : 0;
  if (pct <= 0.25) {
    return { bar: 'bg-rose-500', text: 'text-rose-400' };
  }
  if (pct <= 0.5) {
    return { bar: 'bg-amber-500', text: 'text-amber-400' };
  }
  return { bar: 'bg-emerald-500', text: 'text-emerald-400' };
};
