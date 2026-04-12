import { useNavigate } from 'react-router-dom';
import { SiteHeader } from '../components/SiteHeader';
import { DmFooter } from '../components/DmFooter';

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="space-y-2">
    <h3 className="text-amber-400 font-black uppercase tracking-tighter text-sm">{title}</h3>
    {children}
  </div>
);

const Row = ({ label, value, color = 'text-white' }: { label: string; value: string; color?: string }) => (
  <div className="flex justify-between items-baseline gap-4 py-1 border-b border-slate-800">
    <span className="text-slate-300 text-sm">{label}</span>
    <span className={`text-sm font-black ${color}`}>{value}</span>
  </div>
);

export const HowToPlay = () => {
  const navigate = useNavigate();

  return (
    <div className="h-screen bg-slate-950 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900 via-slate-950 to-slate-950 text-white flex flex-col overflow-hidden">
      <SiteHeader />

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-4 md:px-6 pt-20 min-h-0 relative z-[10]">
        <div className="max-w-3xl mx-auto space-y-6 animate-in fade-in zoom-in duration-500 pb-4">
          <div>
            <h1 className="text-3xl md:text-4xl font-display font-black text-amber-500 italic tracking-tighter">How to Play</h1>
            <p className="text-slate-400 text-sm mt-1">No DM experience required. Just vibes and a d20.</p>
          </div>

          <div className="bg-slate-900/80 border-2 border-slate-800 rounded-[32px] p-6 md:p-8 space-y-6">
            <Section title="The Goal">
              <p className="text-slate-300 text-sm leading-relaxed">
                You and your party are heroes in a world of the AI's imagination. Each turn the AI Dungeon Master narrates what's happening and offers three choices. Pick one (or type your own), roll the dice, and see what happens. There's no win condition, just the story.
              </p>
            </Section>

            <Section title="🎲 Die Hard: Rolling the Dice">
              <p className="text-slate-300 text-sm leading-relaxed mb-2">
                Every action is resolved by rolling a d20 and adding your relevant stat. Beat the difficulty to succeed. Fail and take damage.
              </p>
              <Row label="Easy" value="Beat 8" color="text-emerald-400" />
              <Row label="Normal" value="Beat 12" color="text-amber-400" />
              <Row label="Hard" value="Beat 16" color="text-rose-400" />
              <p className="text-slate-500 text-xs mt-2 italic">
                Roll a natural 1? You <em>die</em>... <em>harder</em>. +1 extra damage on top of the difficulty penalty. The dice are merciless.
              </p>
            </Section>

            <Section title="The Three Stats">
              <Row label="⚔️ Might" value="Hit things, break things, be a wrecking ball" />
              <Row label="✨ Magic" value="Spells, arcane effects, summoning problems" />
              <Row label="🃏 Mischief" value="Sneak, lie, steal, convince the dragon you're the tax collector" />
              <p className="text-slate-500 text-xs mt-2">Items in your inventory can grant passive bonuses to any stat. No equipping needed.</p>
            </Section>

            <Section title="Damage & HP">
              <Row label="Fail an easy action" value="-1 HP" color="text-amber-400" />
              <Row label="Fail a normal action" value="-2 HP" color="text-amber-500" />
              <Row label="Fail a hard action" value="-3 HP" color="text-rose-400" />
              <p className="text-slate-500 text-xs mt-2">Only the acting character takes damage. HP can't go below 0.</p>
            </Section>

            <Section title="💀 Downed State">
              <p className="text-slate-300 text-sm leading-relaxed">
                Reach 0 HP and your hero is <strong className="text-white">downed</strong>. They collapse and their turns are skipped. A teammate can revive them with a healing item.
              </p>
            </Section>

            <Section title="Items">
              <p className="text-slate-300 text-sm leading-relaxed mb-2">
                The AI may reward items during the story. From the inventory panel you can:
              </p>
              <Row label="Use" value="Apply a healing item to yourself or a teammate (even a downed one)" />
              <Row label="Give" value="Hand a transferable item to another party member" />
              <p className="text-slate-500 text-xs mt-2">Using and giving items doesn't cost a roll. They always succeed.</p>
            </Section>

            <Section title="🐉 Party Wipes">
              <p className="text-slate-300 text-sm leading-relaxed">
                If <em>everyone</em> goes down at once, the adventure isn't over:
              </p>
              <div className="space-y-1 mt-2">
                <div className="text-sm text-slate-300 p-3 bg-amber-900/20 border border-amber-800/40 rounded-xl">
                  <strong className="text-amber-400">First wipe 🐉</strong> - A magical intervention (dragon, time rewind, divine coincidence) saves the party at 1 HP each. Once per session.
                </div>
                <div className="text-sm text-slate-300 p-3 bg-slate-800/60 border border-slate-700 rounded-xl">
                  <strong className="text-slate-300">Second wipe 🏕️</strong> - The party wakes up somewhere safe and quiet. Battered, humbled, alive. The story continues.
                </div>
              </div>
            </Section>

            <Section title="Turns">
              <p className="text-slate-300 text-sm leading-relaxed">
                Heroes take turns in order. The active hero is highlighted in the party bar at the top. Only the active hero can perform actions, but any hero's items can be used by their owner regardless of turn order.
              </p>
            </Section>
          </div>
        </div>
      </div>

      {/* Pinned bottom button */}
      <div className="px-4 md:px-6 pt-3 pb-6 flex-shrink-0 relative z-[10] max-w-3xl w-full mx-auto">
        <button
          onClick={() => navigate('/')}
          className="w-full py-4 bg-amber-600 hover:bg-amber-500 rounded-[20px] font-black uppercase italic tracking-tighter transition-colors shadow-[0_6px_0_rgb(146,64,14)] text-white"
        >
          Let's Roll
        </button>
      </div>

      <DmFooter />
    </div>
  );
};
