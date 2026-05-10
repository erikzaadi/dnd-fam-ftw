import { type ReactNode, type CSSProperties, useState, useEffect } from 'react';

// Steps 1-3 are anchored callouts. Steps 5-7 are full bottom panels.
// Step 4 = silent wait while roll resolves.

function useElementRect(selector: string | null): DOMRect | null {
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (!selector) {
      return;
    }
    const update = () => {
      const el = document.querySelector(selector);
      setRect(el ? el.getBoundingClientRect() : null);
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [selector]);

  return rect;
}

function Callout({ children, style }: { children: ReactNode; style: CSSProperties }) {
  return (
    <div className="fixed z-[150] pointer-events-none" style={style}>
      <div className="bg-slate-900/95 backdrop-blur-md border border-amber-600/40 rounded-2xl shadow-xl shadow-black/60 px-4 py-3 animate-in fade-in slide-in-from-top-2 duration-300 max-w-xs">
        {children}
      </div>
    </div>
  );
}

function CalloutTitle({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-1.5">
      <span className="text-amber-400 text-sm flex-shrink-0">✦</span>
      <p className="text-sm font-black uppercase tracking-[0.2em] text-amber-400">{children}</p>
    </div>
  );
}

function CalloutBody({ children }: { children: ReactNode }) {
  return <p className="text-sm text-slate-300 leading-relaxed pl-5">{children}</p>;
}

function CalloutButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <div className="pl-5 mt-2.5 pointer-events-auto">
      <button
        onClick={onClick}
        className="px-4 py-2 bg-amber-600 hover:bg-amber-500 rounded-xl text-xs font-black uppercase tracking-widest text-white transition-all"
      >
        {children}
      </button>
    </div>
  );
}

function BottomPanel({ title, children, cta, onAdvance }: { title: string; children: ReactNode; cta: string; onAdvance: () => void }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-[150] flex justify-center pointer-events-none px-4 pb-4">
      <div className="pointer-events-auto w-full max-w-lg bg-slate-900/95 backdrop-blur-md border border-amber-600/30 rounded-[28px] shadow-2xl shadow-black/60 p-5 animate-in slide-in-from-bottom-4 duration-300">
        <div className="flex items-start gap-3 mb-4">
          <span className="text-amber-400 text-lg flex-shrink-0 mt-0.5">✦</span>
          <p className="text-sm font-black uppercase tracking-[0.2em] text-amber-400">{title}</p>
        </div>
        <div className="mb-4 pl-6 text-sm text-slate-300 leading-relaxed space-y-3">{children}</div>
        <div className="pl-6">
          <button
            onClick={onAdvance}
            className="px-5 py-2.5 bg-amber-600 hover:bg-amber-500 rounded-2xl text-xs font-black uppercase tracking-widest text-white transition-all"
          >
            {cta}
          </button>
        </div>
      </div>
    </div>
  );
}

export const OnboardingOverlay = ({
  step,
  onAdvance,
}: {
  step: number | null;
  onAdvance: () => void;
}) => {
  const storyBoxRect = useElementRect(step === 1 ? '[data-tutorial="story-box"]' : null);
  const partyBoxRect = useElementRect(step === 2 ? '[data-tutorial="party-box"]' : null);
  const actionDockRect = useElementRect(step === 3 ? '[data-tutorial="action-input"]' : null);
  const topControlsRect = useElementRect(step === 6 ? '[data-tutorial="top-controls"]' : null);

  if (step === null || step === 4) {
    return null;
  }

  // Step 1: Story box - anchored to top-left corner of the story box element
  if (step === 1) {
    const style: CSSProperties = storyBoxRect
      ? { top: storyBoxRect.top + 8, left: storyBoxRect.left + 8 }
      : { top: 80, left: 16 };
    return (
      <Callout style={style}>
        <CalloutTitle>The Story Box</CalloutTitle>
        <CalloutBody>
          The DM narrates what happens here. Read it after every turn.{' '}
          <span className="text-amber-300 font-bold">Tap it to read in full screen.</span>
        </CalloutBody>
        <CalloutButton onClick={onAdvance}>Got it</CalloutButton>
      </Callout>
    );
  }

  // Step 2: Party box - anchored below the party box in the HUD
  if (step === 2) {
    const style: CSSProperties = partyBoxRect
      ? { top: partyBoxRect.bottom + 8, left: partyBoxRect.left }
      : { top: 80, left: 16 };
    return (
      <Callout style={style}>
        <p className="text-amber-500 text-center text-sm mb-1 animate-bounce">↑</p>
        <CalloutTitle>The Party Box</CalloutTitle>
        <CalloutBody>
          Your heroes, their HP and stats. Tap any hero for their full sheet.{' '}
          <span className="text-amber-300 font-bold">Items in their inventory can be used during actions.</span>
        </CalloutBody>
        <CalloutButton onClick={onAdvance}>Got it</CalloutButton>
      </Callout>
    );
  }

  // Step 3: Action dock callout - anchored above the action dock
  if (step === 3) {
    const style: CSSProperties = actionDockRect
      ? {
        top: actionDockRect.top - 8,
        left: actionDockRect.left + actionDockRect.width / 2,
        transform: 'translate(-50%, -100%)',
      }
      : { bottom: 120, left: '50%', transform: 'translateX(-50%)' };
    return (
      <div className="fixed z-[150] pointer-events-none" style={style}>
        <div className="w-72 bg-slate-900/90 backdrop-blur-md border border-amber-600/40 rounded-2xl shadow-xl shadow-black/60 px-4 py-3 animate-in fade-in duration-300">
          <CalloutTitle>Your turn</CalloutTitle>
          <CalloutBody>
            Pick an action from the dock below - or type your own and hit{' '}
            <span className="text-amber-300 font-bold">Unleash</span>. Your hero attempts it and the DM narrates what happens.
          </CalloutBody>
          <CalloutButton onClick={onAdvance}>Got it</CalloutButton>
          <p className="text-amber-500 text-center text-sm mt-2 animate-bounce">↓</p>
        </div>
      </div>
    );
  }

  // Step 5: Roll explanation
  if (step === 5) {
    return (
      <BottomPanel title="That was the roll" cta="Got it" onAdvance={onAdvance}>
        <p>
          When a hero attempts something, a <span className="text-amber-300 font-bold">d20 is rolled</span> and their relevant stat bonus is added. Beat the difficulty target and it succeeds - fall short and there are consequences.
        </p>
        <p>
          The popup shows the exact breakdown: roll + bonuses vs target. HP changes and item effects appear there too.
        </p>
      </BottomPanel>
    );
  }

  // Step 6: Controls - anchored below the top-right controls area
  if (step === 6) {
    const style: CSSProperties = topControlsRect
      ? {
        top: topControlsRect.bottom + 8,
        right: window.innerWidth - topControlsRect.right,
      }
      : { top: 60, right: 16 };
    return (
      <Callout style={style}>
        <CalloutTitle>Controls at the top</CalloutTitle>
        <CalloutBody>
          The <span className="text-amber-300 font-bold">gear icon</span> opens quick settings - toggle images, mute audio, and adjust narration.
        </CalloutBody>
        <CalloutBody>
          <span className="text-amber-300 font-bold">Collapse</span> hides the party banner for more story space. Press <span className="font-mono text-xs bg-slate-800 px-1 rounded">b</span> anytime to toggle it.
        </CalloutBody>
        <CalloutButton onClick={onAdvance}>Got it</CalloutButton>
      </Callout>
    );
  }

  // Step 7: Chronicle + TTS
  if (step === 7) {
    return (
      <BottomPanel title="The Chronicle" cta="Let's go!" onAdvance={onAdvance}>
        <p>
          Every turn is saved in the <span className="text-amber-300 font-bold">Chronicle</span>. Tap the scroll icon in the story box (or press <span className="font-mono text-xs bg-slate-800 px-1 rounded">c</span>) to browse the full history of your campaign.
        </p>
        <p>
          One more thing: the DM can <span className="text-amber-300 font-bold">read narration aloud</span>. Enable it in Settings if you want the full tavern experience.
        </p>
      </BottomPanel>
    );
  }

  return null;
};
