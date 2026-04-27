export type RollImpact = 'normal' | 'strong' | 'extreme';

export interface RollImpactOutcome {
  label: string;
  detail: string;
  containerClass: string;
  badgeClass: string;
  glowClass: string;
  textClass: string;
  popupGlow: string;
}

export const getRollImpactOutcome = (roll?: number, success?: boolean, impact: RollImpact = 'normal'): RollImpactOutcome | null => {
  if (roll === 1) {
    return {
      label: 'Critical Failure',
      detail: 'Natural 1',
      containerClass: 'border-rose-500/80 shadow-rose-950/60',
      badgeClass: 'border-rose-500/60 bg-rose-950/70 text-rose-200',
      glowClass: 'bg-rose-500/20',
      textClass: 'text-rose-300',
      popupGlow: 'rgba(244, 63, 94, 0.72)',
    };
  }

  if (roll === 20) {
    return {
      label: 'Legendary Success',
      detail: 'Natural 20',
      containerClass: 'border-emerald-400/80 shadow-emerald-950/60',
      badgeClass: 'border-emerald-400/60 bg-emerald-950/70 text-emerald-200',
      glowClass: 'bg-emerald-400/20',
      textClass: 'text-emerald-300',
      popupGlow: 'rgba(52, 211, 153, 0.72)',
    };
  }

  if (impact === 'extreme') {
    if (success) {
      return {
        label: 'Legendary Success',
        detail: 'Epic result',
        containerClass: 'border-emerald-400/80 shadow-emerald-950/60',
        badgeClass: 'border-emerald-400/60 bg-emerald-950/70 text-emerald-200',
        glowClass: 'bg-emerald-400/20',
        textClass: 'text-emerald-300',
        popupGlow: 'rgba(52, 211, 153, 0.72)',
      };
    }
    return {
      label: 'Catastrophic Failure',
      detail: 'Dire consequence',
      containerClass: 'border-rose-500/80 shadow-rose-950/60',
      badgeClass: 'border-rose-500/60 bg-rose-950/70 text-rose-200',
      glowClass: 'bg-rose-500/20',
      textClass: 'text-rose-300',
      popupGlow: 'rgba(244, 63, 94, 0.72)',
    };
  }

  if (impact === 'strong') {
    if (success) {
      return {
        label: 'Heroic Success',
        detail: 'Powerful result',
        containerClass: 'border-amber-400/80 shadow-amber-950/60',
        badgeClass: 'border-amber-400/60 bg-amber-950/70 text-amber-200',
        glowClass: 'bg-amber-400/16',
        textClass: 'text-amber-300',
        popupGlow: 'rgba(251, 191, 36, 0.58)',
      };
    }
    return {
      label: 'Major Twist',
      detail: 'Serious consequence',
      containerClass: 'border-orange-500/80 shadow-orange-950/60',
      badgeClass: 'border-orange-500/60 bg-orange-950/70 text-orange-200',
      glowClass: 'bg-orange-500/16',
      textClass: 'text-orange-300',
      popupGlow: 'rgba(249, 115, 22, 0.58)',
    };
  }

  return null;
};
