/** Display config for non-normal turn types (intervention, sanctuary). */
export const SPECIAL_TURNS: Record<string, { img: string; label: string; borderClass: string; textClass: string }> = {
  intervention: {
    img: '/images/intervention_dragon.png',
    label: 'Miraculous Rescue',
    borderClass: 'border-amber-500/60',
    textClass: 'text-amber-400',
  },
  sanctuary: {
    img: '/images/sanctuary_light.png',
    label: 'Sanctuary',
    borderClass: 'border-blue-400/60',
    textClass: 'text-blue-300',
  },
};
