import { useNavigate } from 'react-router-dom';
import { SiteHeader } from '../components/SiteHeader';
import { DmFooter } from '../components/DmFooter';
import { imgSrc } from '../lib/api';
import { StatImg } from '../components/game/StatIcon';

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="space-y-3">
    <h3 className="text-amber-400 font-black uppercase tracking-tighter text-xl">{title}</h3>
    {children}
  </div>
);

const Row = ({ label, value, color = 'text-white' }: { label: React.ReactNode; value: string; color?: string }) => (
  <div className="flex justify-between items-center gap-6 py-2 border-b border-slate-800">
    <span className="text-slate-300 text-base">{label}</span>
    <span className={`text-base font-black ${color}`}>{value}</span>
  </div>
);

export const HowToPlay = () => {
  const navigate = useNavigate();

  return (
    <div className="h-screen bg-slate-950 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900 via-slate-950 to-slate-950 text-white flex flex-col overflow-hidden">
      <SiteHeader />

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-4 md:px-8 pt-6 min-h-0 relative z-[10]">
        <div className="max-w-5xl mx-auto space-y-8 animate-in fade-in zoom-in duration-500 pb-6">
          <div>
            <h1 className="text-5xl md:text-6xl font-display font-black text-amber-500 italic tracking-tighter">How to Play</h1>
            <p className="text-slate-400 text-lg mt-2">No DM experience required. Just vibes and a d20.</p>
          </div>

          <div className="bg-slate-900/80 border-2 border-slate-800 rounded-[32px] p-6 md:p-10 space-y-10">
            <Section title="The Goal">
              <p className="text-slate-300 text-lg leading-relaxed">
                You and your party are heroes in a world of the AI's imagination. Each turn the AI Dungeon Master narrates what's happening and offers three choices. Pick one (or type your own), roll the dice, and see what happens. There's no win condition, just the story.
              </p>
            </Section>

            <Section title="🎲 Die Hard: Rolling the Dice">
              <p className="text-slate-300 text-lg leading-relaxed mb-3">
                Every action is resolved by rolling a d20 and adding your relevant stat. Beat the target to succeed. Fail and take damage.
              </p>
              <Row label="Easy" value="Around 8" color="text-emerald-400" />
              <Row label="Normal" value="Around 12" color="text-amber-400" />
              <Row label="Hard" value="Around 16" color="text-rose-400" />
              <p className="text-slate-400 text-base mt-4 leading-relaxed">
                These are baselines, not rules. The AI adjusts the exact target per action based on context - picking a lock in complete darkness is harder than in daylight, even if both are labeled <em>normal</em>. The precise number is shown on the die before you roll.
              </p>
              <p className="text-slate-500 text-base mt-3 italic">
                Roll a natural 1? You <em>die</em>... <em>harder</em>. +1 extra damage on top of the difficulty penalty. The dice are merciless.
              </p>
            </Section>

            <Section title="The Three Stats">
              <Row label={<span className="flex items-center gap-2"><StatImg stat="might" size="10" rounded /> Might</span>} value="Hit things, break things, be a wrecking ball" />
              <Row label={<span className="flex items-center gap-2"><StatImg stat="magic" size="10" rounded /> Magic</span>} value="Spells, arcane effects, summoning problems" />
              <Row label={<span className="flex items-center gap-2"><StatImg stat="mischief" size="10" rounded /> Mischief</span>} value="Sneak, lie, steal, convince the dragon you're the tax collector" />
              <p className="text-slate-500 text-base mt-3">Items in your inventory can grant passive bonuses to any stat. No equipping needed.</p>
            </Section>

            <Section title="Damage & HP">
              <Row label="Fail an easy action" value="-1 HP" color="text-amber-400" />
              <Row label="Fail a normal action" value="-2 HP" color="text-amber-500" />
              <Row label="Fail a hard action" value="-3 HP" color="text-rose-400" />
              <p className="text-slate-500 text-base mt-3">Only the acting character takes damage. HP can't go below 0.</p>
            </Section>

            <Section title="💀 Downed State">
              <p className="text-slate-300 text-lg leading-relaxed">
                Reach 0 HP and your hero is <strong className="text-white">downed</strong>. They collapse and their turns are skipped. A teammate can revive them with a healing item.
              </p>
            </Section>

            <Section title="Items">
              <div className="flex items-start gap-4">
                <img src={imgSrc('/images/icon_potion.png')} alt="potion" className="w-16 h-16 object-contain mix-blend-screen flex-shrink-0 mt-1" />
                <div className="flex-1">
                  <p className="text-slate-300 text-lg leading-relaxed mb-3">
                    The AI may reward items during the story. From the inventory panel you can:
                  </p>
                  <Row label="Use" value="Apply a healing item to yourself or a teammate (even a downed one)" />
                  <Row label="Give" value="Hand a transferable item to another party member" />
                  <p className="text-slate-500 text-base mt-3">Using and giving items doesn't cost a roll. They always succeed.</p>
                </div>
              </div>
            </Section>

            <Section title="🪙 Trading">
              <p className="text-slate-300 text-lg leading-relaxed">
                When a merchant, vendor, or trader appears in the story, the AI may offer a trade action. Accepting a trade can swap one of your items for something new - choose wisely, trades are final.
              </p>
            </Section>

            <Section title="🐉 Party Wipes">
              <p className="text-slate-300 text-lg leading-relaxed">
                If <em>everyone</em> goes down at once, the adventure isn't over:
              </p>
              <div className="space-y-2 mt-3">
                <div className="text-base text-slate-300 p-4 bg-amber-900/20 border border-amber-800/40 rounded-2xl">
                  <strong className="text-amber-400">First wipe 🐉</strong> - A magical intervention (dragon, time rewind, divine coincidence) saves the party at 1 HP each. Once per session.
                </div>
                <div className="text-base text-slate-300 p-4 bg-slate-800/60 border border-slate-700 rounded-2xl">
                  <strong className="text-slate-300">Second wipe 🏕️</strong> - The party wakes up somewhere safe and quiet. Battered, humbled, alive. The story continues.
                </div>
              </div>
            </Section>

            <Section title="Turns">
              <p className="text-slate-300 text-lg leading-relaxed">
                Heroes take turns in order. The active hero is highlighted in the party bar at the top. Only the active hero can perform actions, but any hero's items can be used by their owner regardless of turn order.
              </p>
            </Section>
          </div>
        </div>
      </div>

      {/* Pinned bottom button */}
      <div className="px-4 md:px-8 pt-3 pb-6 flex-shrink-0 relative z-[10] max-w-5xl w-full mx-auto">
        <button
          onClick={() => navigate('/')}
          className="w-full py-5 bg-amber-600 hover:bg-amber-500 rounded-[20px] font-black uppercase italic tracking-tighter transition-colors shadow-[0_6px_0_rgb(146,64,14)] text-white text-xl"
        >
          Let's Roll
        </button>
      </div>

      <DmFooter />
    </div>
  );
};
