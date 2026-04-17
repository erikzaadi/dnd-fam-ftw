import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { DmFooter } from '../components/DmFooter';
import { SiteHeader } from '../components/SiteHeader';
import { api } from '../lib/api';

interface AppSettings {
  imagesEnabled: boolean;
  defaultUseLocalAI: boolean;
}

const Toggle = ({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label: string; description: string }) => (
  <div className="flex items-center justify-between gap-6 p-5 bg-black/40 rounded-[20px] border-2 border-slate-800">
    <div className="flex flex-col gap-1">
      <span className="font-black uppercase tracking-tighter text-white">{label}</span>
      <span className="text-sm text-slate-400">{description}</span>
    </div>
    <button
      onClick={() => onChange(!checked)}
      className={`relative w-14 h-7 rounded-full transition-colors flex-shrink-0 ${checked ? 'bg-amber-600' : 'bg-slate-700'}`}
    >
      <span className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-all ${checked ? 'left-8' : 'left-1'}`} />
    </button>
  </div>
);

export const Settings = () => {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [saved, setSaved] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    fetch(api('/settings'))
      .then(r => r.json())
      .then(setSettings);
  }, []);

  const update = (patch: Partial<AppSettings>) => {
    setSettings(s => s ? { ...s, ...patch } : s);
    setSaved(false);
  };

  const save = async () => {
    if (!settings) return;
    await fetch(api('/settings'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    });
    setSaved(true);
    setTimeout(() => navigate('/'), 1200);
  };

  return (
    <div className="h-screen bg-slate-950 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900 via-slate-950 to-slate-950 text-white flex flex-col overflow-hidden">
      <SiteHeader />

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-6 min-h-0">
        <div className="max-w-lg mx-auto space-y-8 animate-in fade-in zoom-in duration-700 relative z-[10]">
          <h1 className="text-4xl md:text-5xl font-display font-black text-amber-500 italic tracking-tighter">Settings</h1>

          {!settings ? (
            <p className="text-slate-400 text-center py-8">Loading…</p>
          ) : (
            <div className="bg-slate-900 p-6 md:p-8 rounded-[32px] border-2 border-slate-800 shadow-2xl space-y-4">
              <h2 className="text-lg font-black uppercase tracking-tighter text-slate-400">AI</h2>
              <Toggle
                checked={settings.defaultUseLocalAI}
                onChange={v => update({ defaultUseLocalAI: v })}
                label="Local AI by default"
                description="New sessions default to local AI instead of cloud. Can still be overridden per session."
              />

              <h2 className="text-lg font-black uppercase tracking-tighter text-slate-400 pt-2">Images</h2>
              <Toggle
                checked={settings.imagesEnabled}
                onChange={v => update({ imagesEnabled: v })}
                label="Image generation"
                description="Generate scene illustrations and character avatars. Disable for faster turns or when no image provider is configured."
              />
              {!settings.imagesEnabled && (
                <p className="text-xs text-slate-500 px-2">Character avatars will use SVG initials instead.</p>
              )}

              <div className="pt-4 flex items-center gap-4">
                <button
                  onClick={() => navigate('/')}
                  className="px-6 py-4 bg-slate-800 hover:bg-slate-700 rounded-[20px] font-black uppercase italic tracking-tighter transition-colors border-2 border-slate-700"
                >
                  Cancel
                </button>
                <button
                  onClick={save}
                  className="flex-1 py-4 bg-amber-600 hover:bg-amber-500 rounded-[20px] font-black uppercase italic tracking-tighter transition-colors shadow-[0_6px_0_rgb(146,64,14)]"
                >
                  Save
                </button>
                {saved && <span className="text-emerald-400 font-black uppercase tracking-tighter text-sm">Saved ✓</span>}
              </div>
            </div>
          )}
        </div>
      </div>
      <DmFooter />
    </div>
  );
};
