import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { DmFooter } from '../components/DmFooter';
import { SiteHeader } from '../components/SiteHeader';
import { apiFetch } from '../lib/api';
import { RangeSlider } from '../components/RangeSlider';

interface AppSettings {
  imagesEnabled: boolean;
  defaultUseLocalAI: boolean;
}

interface Capabilities {
  hasLocalAI: boolean;
  hasCloudAI: boolean;
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

import { useAudioSettings } from '../audio/useAudioSettings';
import { audioManager } from '../audio/audioManager';
import { useTtsSettings } from '../tts/useTtsSettings';
import { useAvailableVoices } from '../tts/useAvailableVoices';
import { browserTtsService } from '../tts/browserTtsService';
import { TEST_VOICE_SAMPLE } from '../tts/ttsVoiceCatalog';
import { useSttSettings } from '../stt/useSttSettings';
import { getSpeechRecognitionCtor } from '../stt/browserSpeechRecognitionService';

type Tab = 'game' | 'music' | 'sfx' | 'narration';

const TAB_LABELS: { id: Tab; label: string }[] = [
  { id: 'game', label: 'Game' },
  { id: 'music', label: 'Music' },
  { id: 'sfx', label: 'SFX' },
  { id: 'narration', label: 'Narration' },
];

export const Settings = () => {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [saved, setSaved] = useState(false);
  const [tab, setTab] = useState<Tab>('game');
  const [musicPlaying, setMusicPlaying] = useState(false);
  const [sfxPlaying, setSfxPlaying] = useState<string | null>(null);
  const [ttsPlaying, setTtsPlaying] = useState(false);
  const navigate = useNavigate();

  // Poll TTS playing state
  useEffect(() => {
    const id = setInterval(() => {
      setTtsPlaying(browserTtsService.isSpeaking());
    }, 200);
    return () => clearInterval(id);
  }, []);
  const {
    settings: audioSettings,
    setEnabled,
    setMusicEnabled,
    setMasterMuted,
    setMusicVolume,
    setSfxEnabled,
    setSfxVolume,
    setSillyMode,
  } = useAudioSettings();

  const {
    settings: ttsSettings,
    setEnabled: setTtsEnabled,
    setAutoSpeakNarration,
    setVolume: setTtsVolume,
    setRate,
    setPitch,
    setPreferredVoice,
    setPreferredStyle,
    setPreferredGenderHint,
  } = useTtsSettings();
  const {
    settings: sttSettings,
    setEnabled: setSttEnabled,
  } = useSttSettings();

  const availableVoices = useAvailableVoices();
  const ttsSupported = browserTtsService.isSupported();
  const sttSupported = getSpeechRecognitionCtor() !== null;

  const savedVoiceUnavailable =
    ttsSettings.preferredVoiceURI !== null &&
    availableVoices.length > 0 &&
    !availableVoices.some(v => v.voiceURI === ttsSettings.preferredVoiceURI);

  useEffect(() => {
    apiFetch('/settings')
      .then(r => r.json())
      .then(setSettings);
    apiFetch('/capabilities')
      .then(r => r.json())
      .then(setCapabilities);
  }, []);

  const update = (patch: Partial<AppSettings>) => {
    setSettings(s => s ? { ...s, ...patch } : s);
    setSaved(false);
  };

  const save = async () => {
    if (!settings) {
      return;
    }
    await apiFetch('/settings', {
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

      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-6 min-h-0">
        <div className="max-w-2xl mx-auto space-y-6 animate-in fade-in zoom-in duration-700 relative z-[10]">
          <h1 className="text-4xl md:text-5xl font-display font-black text-amber-500 italic tracking-tighter">Settings</h1>

          {/* Tab bar */}
          <div className="flex gap-1 p-1 bg-slate-900 rounded-2xl border border-slate-800">
            {TAB_LABELS.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex-1 py-3 rounded-xl font-black uppercase tracking-widest text-sm transition-all ${tab === t.id ? 'bg-amber-600 text-white shadow' : 'text-slate-500 hover:text-slate-300'}`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {!settings ? (
            <p className="text-slate-400 text-center py-8">Loading...</p>
          ) : (
            <div className="bg-slate-900 p-6 md:p-8 rounded-[32px] border-2 border-slate-800 shadow-2xl space-y-4">

              {/* GAME TAB */}
              {tab === 'game' && (
                <>
                  <h2 className="text-lg font-black uppercase tracking-tighter text-slate-400">Images</h2>
                  <Toggle
                    checked={settings.imagesEnabled}
                    onChange={v => update({ imagesEnabled: v })}
                    label="Image generation"
                    description="Generate scene illustrations and character avatars. Disable for faster turns or when no image provider is configured."
                  />
                  {!settings.imagesEnabled && (
                    <p className="text-xs text-slate-500 px-2">Character avatars will use SVG initials instead.</p>
                  )}

                  {capabilities?.hasLocalAI && (
                    <>
                      <h2 className="text-lg font-black uppercase tracking-tighter text-slate-400 pt-2">AI</h2>
                      <Toggle
                        checked={settings.defaultUseLocalAI}
                        onChange={v => update({ defaultUseLocalAI: v })}
                        label="Local AI by default"
                        description="New sessions default to local AI instead of cloud. Can still be overridden per session."
                      />
                    </>
                  )}
                </>
              )}

              {/* MUSIC TAB */}
              {tab === 'music' && (
                <>
                  <h2 className="text-lg font-black uppercase tracking-tight text-amber-500">Music</h2>
                  <Toggle
                    checked={audioSettings.enabled}
                    onChange={setEnabled}
                    label="Enable Audio"
                    description="Turn on music, sound effects, and narration voice for the game."
                  />
                  {audioSettings.enabled && (
                    <>
                      <Toggle
                        checked={audioSettings.masterMuted}
                        onChange={setMasterMuted}
                        label="Mute All"
                        description="Silence all audio including music, sound effects, and narration voice."
                      />
                      <Toggle
                        checked={audioSettings.musicEnabled}
                        onChange={setMusicEnabled}
                        label="Background Music"
                        description="Play random ambient tracks during the adventure."
                      />
                      {audioSettings.musicEnabled && (
                        <>
                          <RangeSlider
                            label="Music Volume"
                            value={audioSettings.musicVolume}
                            min={0}
                            max={1}
                            step={0.05}
                            displayValue={`${Math.round(audioSettings.musicVolume * 100)}%`}
                            onChange={setMusicVolume}
                          />
                          <button
                            disabled={audioSettings.masterMuted || !audioSettings.enabled}
                            onClick={() => {
                              if (musicPlaying) {
                                audioManager.stopMusic();
                                setMusicPlaying(false);
                              } else {
                                audioManager.startAmbientMusic();
                                setMusicPlaying(true);
                              }
                            }}
                            className={`w-full py-3 rounded-[20px] font-black uppercase italic tracking-tighter transition-colors text-sm border-2 disabled:opacity-40 disabled:cursor-not-allowed ${musicPlaying ? 'bg-rose-900/40 border-rose-700 text-rose-300 hover:bg-rose-900/60' : 'bg-slate-700 hover:bg-slate-600 border-slate-600 text-white'}`}
                          >
                            {musicPlaying ? '⏹ Stop Music' : '▶ Test Music'}
                          </button>
                        </>
                      )}
                    </>
                  )}
                </>
              )}

              {/* SFX TAB */}
              {tab === 'sfx' && (
                <>
                  <h2 className="text-lg font-black uppercase tracking-tight text-amber-500">Sound Effects</h2>
                  <Toggle
                    checked={audioSettings.enabled}
                    onChange={setEnabled}
                    label="Enable Audio"
                    description="Turn on music, sound effects, and narration voice for the game."
                  />
                  {audioSettings.enabled && (
                    <>
                      <Toggle
                        checked={audioSettings.masterMuted}
                        onChange={setMasterMuted}
                        label="Mute All"
                        description="Silence all audio including music, sound effects, and narration voice."
                      />
                      <Toggle
                        checked={audioSettings.sfxEnabled}
                        onChange={setSfxEnabled}
                        label="Sound Effects"
                        description="Play sound effects for dice rolls and game actions."
                      />
                      <RangeSlider
                        label="SFX Volume"
                        value={audioSettings.sfxVolume}
                        min={0}
                        max={1}
                        step={0.05}
                        displayValue={`${Math.round(audioSettings.sfxVolume * 100)}%`}
                        onChange={setSfxVolume}
                      />
                      {audioSettings.sfxEnabled && (
                        <div className="flex gap-3">
                          <button
                            disabled={audioSettings.masterMuted || !audioSettings.enabled}
                            onClick={() => {
                              audioManager.playSfx('dice-roll');
                              setSfxPlaying('dice');
                              setTimeout(() => setSfxPlaying(null), 1200);
                            }}
                            className={`flex-1 py-3 rounded-[20px] font-black uppercase italic tracking-tighter transition-colors text-sm border-2 disabled:opacity-40 disabled:cursor-not-allowed ${sfxPlaying === 'dice' ? 'bg-amber-900/40 border-amber-700 text-amber-300' : 'bg-slate-700 hover:bg-slate-600 border-slate-600'}`}
                          >
                            {sfxPlaying === 'dice' ? '🎲 Playing...' : audioSettings.sillyMode ? '🎲 Silly SFX' : '🎲 Test SFX'}
                          </button>
                          <button
                            disabled={audioSettings.masterMuted || !audioSettings.enabled}
                            onClick={() => {
                              audioManager.playSfx('roll-20');
                              setSfxPlaying('roll20');
                              setTimeout(() => setSfxPlaying(null), 2000);
                            }}
                            className={`flex-1 py-3 rounded-[20px] font-black uppercase italic tracking-tighter transition-colors text-sm border-2 disabled:opacity-40 disabled:cursor-not-allowed ${sfxPlaying === 'roll20' ? 'bg-amber-900/40 border-amber-700 text-amber-300' : 'bg-slate-700 hover:bg-slate-600 border-slate-600'}`}
                          >
                            {sfxPlaying === 'roll20' ? '⭐ Playing...' : audioSettings.sillyMode ? '⭐ Silly 20' : '⭐ Roll 20'}
                          </button>
                        </div>
                      )}
                      <Toggle
                        checked={audioSettings.sillyMode}
                        onChange={setSillyMode}
                        label="Silly Mode"
                        description="50% chance to swap some sound effects with sillier alternatives."
                      />
                    </>
                  )}
                </>
              )}

              {/* NARRATION TAB */}
              {tab === 'narration' && (
                <>
                  <h2 className="text-lg font-black uppercase tracking-tight text-amber-500">Narration Voice</h2>
                  {!ttsSupported ? (
                    <p className="text-sm text-slate-500 px-2">Narration voice is not supported in this browser.</p>
                  ) : (
                    <>
                      <Toggle
                        checked={ttsSettings.enabled}
                        onChange={setTtsEnabled}
                        label="Narration Voice"
                        description="Read turn narrations aloud using your device voice."
                      />
                      {ttsSettings.enabled && (
                        <>
                          <Toggle
                            checked={ttsSettings.autoSpeakNarration}
                            onChange={setAutoSpeakNarration}
                            label="Auto-read narration"
                            description="Automatically speak each new turn narration. Manual replay always available."
                          />
                          <div className="flex flex-col gap-2 p-5 bg-black/40 rounded-[20px] border-2 border-slate-800">
                            <span className="font-black uppercase tracking-tighter text-white">Voice</span>
                            {savedVoiceUnavailable && (
                              <p className="text-xs text-amber-400">Saved voice is unavailable on this device - using best match.</p>
                            )}
                            {availableVoices.length === 0 ? (
                              <p className="text-sm text-slate-500">Loading available voices...</p>
                            ) : (
                              <select
                                value={ttsSettings.preferredVoiceURI ?? ''}
                                onChange={e => {
                                  const voice = availableVoices.find(v => v.voiceURI === e.target.value) ?? null;
                                  setPreferredVoice(voice?.voiceURI ?? null, voice?.name ?? null, voice?.lang ?? null);
                                }}
                                className="w-full bg-slate-800 text-white rounded-xl px-3 py-2 border border-slate-700 text-sm"
                              >
                                <option value="">Best available voice</option>
                                {availableVoices.map(v => (
                                  <option key={v.voiceURI} value={v.voiceURI}>
                                    {v.name} ({v.lang}){v.default ? ' - default' : ''}
                                  </option>
                                ))}
                              </select>
                            )}
                          </div>
                          <div className="flex flex-col gap-2 p-5 bg-black/40 rounded-[20px] border-2 border-slate-800">
                            <span className="font-black uppercase tracking-tighter text-white">Voice Style</span>
                            <select
                              value={ttsSettings.preferredStyle}
                              onChange={e => setPreferredStyle(e.target.value as typeof ttsSettings.preferredStyle)}
                              className="w-full bg-slate-800 text-white rounded-xl px-3 py-2 border border-slate-700 text-sm"
                            >
                              <option value="neutral">Neutral</option>
                              <option value="heroic">Heroic - slower, deeper</option>
                              <option value="mysterious">Mysterious - slowest, lowest</option>
                              <option value="playful">Playful - faster, lighter</option>
                            </select>
                          </div>
                          <div className="flex flex-col gap-2 p-5 bg-black/40 rounded-[20px] border-2 border-slate-800">
                            <span className="font-black uppercase tracking-tighter text-white">Voice Preference</span>
                            <p className="text-xs text-slate-500">Gender is a preference hint - available voices depend on your browser and device.</p>
                            <select
                              value={ttsSettings.preferredGenderHint}
                              onChange={e => setPreferredGenderHint(e.target.value as typeof ttsSettings.preferredGenderHint)}
                              className="w-full bg-slate-800 text-white rounded-xl px-3 py-2 border border-slate-700 text-sm"
                            >
                              <option value="any">Any voice</option>
                              <option value="female">Prefer female</option>
                              <option value="male">Prefer male</option>
                            </select>
                          </div>
                          <RangeSlider
                            label="Speech Speed"
                            value={ttsSettings.rate}
                            min={0.7}
                            max={1.4}
                            step={0.05}
                            displayValue={`${ttsSettings.rate.toFixed(2)}x`}
                            onChange={setRate}
                          />
                          <RangeSlider
                            label="Pitch"
                            value={ttsSettings.pitch}
                            min={0.5}
                            max={1.5}
                            step={0.05}
                            displayValue={ttsSettings.pitch.toFixed(2)}
                            onChange={setPitch}
                          />
                          <RangeSlider
                            label="Voice Volume"
                            value={ttsSettings.volume}
                            min={0}
                            max={1}
                            step={0.05}
                            displayValue={`${Math.round(ttsSettings.volume * 100)}%`}
                            onChange={setTtsVolume}
                          />
                          <button
                            disabled={!ttsSettings.enabled}
                            onClick={() => {
                              if (ttsPlaying) {
                                browserTtsService.stop();
                              } else {
                                browserTtsService.speakNarration(TEST_VOICE_SAMPLE, ttsSettings);
                              }
                            }}
                            className={`w-full py-3 rounded-[20px] font-black uppercase italic tracking-tighter transition-colors text-sm border-2 disabled:opacity-40 disabled:cursor-not-allowed ${ttsPlaying ? 'bg-rose-900/40 border-rose-700 text-rose-300 hover:bg-rose-900/60' : 'bg-slate-700 hover:bg-slate-600 border-slate-600 text-white'}`}
                          >
                            {ttsPlaying ? '⏹ Stop Narration' : '🔊 Test Voice'}
                          </button>
                        </>
                      )}
                    </>
                  )}
                  <h2 className="text-lg font-black uppercase tracking-tight text-amber-500 pt-4">Voice Input</h2>
                  {!sttSupported && (
                    <p className="text-sm text-slate-500 px-2">Speech input is not supported in this browser.</p>
                  )}
                  <Toggle
                    checked={sttSettings.enabled}
                    onChange={setSttEnabled}
                    label="Voice Actions"
                    description="Show the voice action button and enable the V shortcut for speaking actions."
                  />
                </>
              )}

              <div className="pt-4 flex items-center gap-4 border-t border-slate-800">
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
