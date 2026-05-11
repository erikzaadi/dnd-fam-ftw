import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAudioSettings } from '../audio/useAudioSettings';
import { loadFirstRunPreferences, saveFirstRunPreferences } from '../firstRun/firstRunPreferences';
import { useCapabilities } from '../hooks/useCapabilities';
import { apiFetch, imgSrc } from '../lib/api';
import { getSpeechRecognitionCtor } from '../stt/browserSpeechRecognitionService';
import { useSttSettings } from '../stt/useSttSettings';
import { browserTtsService } from '../tts/browserTtsService';
import { useTtsSettings } from '../tts/useTtsSettings';
import type { GameMode } from '../types';

type FirstRunWizardProps = {
  onComplete: () => void;
  onSkip: () => void;
  onStartGetMeRollin?: () => void;
};

type AppSettings = {
  imagesEnabled: boolean;
};

const PACE_OPTIONS: Array<{ id: GameMode; label: string; description: string }> = [
  { id: 'cinematic', label: 'Cinematic', description: 'More story, quieter scenes, and room to breathe.' },
  { id: 'balanced', label: 'Balanced', description: 'A mix of story, danger, and action.' },
  { id: 'fast', label: 'Fast', description: 'More pressure and fewer quiet turns.' },
  { id: 'zug-ma-geddon', label: 'ZUG-MA-GEDDON', description: 'Constant battle. No mercy. No downtime.' },
];

const isMobileBrowser = () =>
  window.matchMedia('(max-width: 767px)').matches ||
  /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

const StepButton = ({
  active,
  title,
  description,
  onClick,
}: {
  active: boolean;
  title: string;
  description: string;
  onClick: () => void;
}) => (
  <button
    type="button"
    onClick={onClick}
    className={`min-h-[92px] rounded-2xl border-2 px-4 py-3 text-left transition-all ${active ? 'border-amber-500 bg-amber-600/15 text-white' : 'border-slate-700 bg-slate-900/70 text-slate-400 hover:border-slate-500'}`}
  >
    <span className="block text-sm font-black uppercase tracking-widest text-amber-300">{title}</span>
    <span className="mt-1 block text-sm leading-snug">{description}</span>
  </button>
);

const ToggleRow = ({
  checked,
  label,
  description,
  onChange,
}: {
  checked: boolean;
  label: string;
  description: string;
  onChange: (value: boolean) => void;
}) => (
  <button
    type="button"
    onClick={() => onChange(!checked)}
    className="flex w-full items-center justify-between gap-4 rounded-2xl border-2 border-slate-800 bg-slate-950/50 px-4 py-3 text-left"
  >
    <span>
      <span className="block text-sm font-black uppercase tracking-widest text-white">{label}</span>
      <span className="mt-1 block text-sm leading-snug text-slate-400">{description}</span>
    </span>
    <span className={`relative h-7 w-14 flex-shrink-0 rounded-full transition-colors ${checked ? 'bg-amber-600' : 'bg-slate-700'}`}>
      <span className={`absolute top-1 h-5 w-5 rounded-full bg-white transition-all ${checked ? 'left-8' : 'left-1'}`} />
    </span>
  </button>
);

export const FirstRunWizard = ({ onComplete, onSkip, onStartGetMeRollin }: FirstRunWizardProps) => {
  const { capabilities } = useCapabilities();
  const {
    settings: audioSettings,
    setEnabled: setAudioSettingEnabled,
    setMusicEnabled: setAudioSettingMusicEnabled,
    setSfxEnabled: setAudioSettingSfxEnabled,
    setSillyMode: setAudioSettingSillyMode,
  } = useAudioSettings();
  const {
    settings: ttsSettings,
    setEnabled: setTtsSettingEnabled,
    setAutoSpeakNarration: setTtsSettingAutoSpeakNarration,
    setProvider: setTtsSettingProvider,
  } = useTtsSettings();
  const {
    settings: sttSettings,
    setEnabled: setSttSettingEnabled,
  } = useSttSettings();
  const browserTtsSupported = browserTtsService.isSupported();
  const speechInputSupported = getSpeechRecognitionCtor() !== null;
  const ttsAvailable = capabilities.hasTts || browserTtsSupported;

  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assetSrc, setAssetSrc] = useState(imgSrc('/images/first_run_wizard.png'));
  const [imagesEnabled, setImagesEnabled] = useState(true);
  const [narrationEnabled, setNarrationEnabled] = useState(ttsSettings.enabled);
  const [autoSpeakNarration, setAutoSpeakNarration] = useState(ttsSettings.autoSpeakNarration);
  const [audioEnabled, setAudioEnabled] = useState(audioSettings.enabled);
  const [musicEnabled, setMusicEnabled] = useState(audioSettings.musicEnabled);
  const [sfxEnabled, setSfxEnabled] = useState(audioSettings.sfxEnabled);
  const [sillyMode, setSillyMode] = useState(audioSettings.sillyMode);
  const [voiceActionsEnabled, setVoiceActionsEnabled] = useState(sttSettings.enabled);
  const [preferredGameMode, setPreferredGameMode] = useState<GameMode>(() => loadFirstRunPreferences().preferredGameMode);

  const preferredTtsProvider = capabilities.hasTts ? 'openai' : 'browser';

  const persistImagesEnabled = useCallback((value: boolean) => {
    setImagesEnabled(value);
    setError(null);
    apiFetch('/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imagesEnabled: value }),
    }).then(res => {
      if (!res.ok) {
        throw new Error('Failed to save image setting');
      }
    }).catch(() => {
      setError('Could not save setup choices. Try again in a moment.');
    });
  }, []);

  const persistNarrationEnabled = useCallback((value: boolean) => {
    setNarrationEnabled(value);
    setTtsSettingProvider(preferredTtsProvider);
    setTtsSettingEnabled(ttsAvailable && value);
    setTtsSettingAutoSpeakNarration(ttsAvailable && value && autoSpeakNarration);
  }, [autoSpeakNarration, preferredTtsProvider, setTtsSettingAutoSpeakNarration, setTtsSettingEnabled, setTtsSettingProvider, ttsAvailable]);

  const persistAutoSpeakNarration = useCallback((value: boolean) => {
    setAutoSpeakNarration(value);
    setTtsSettingProvider(preferredTtsProvider);
    setTtsSettingEnabled(ttsAvailable && narrationEnabled);
    setTtsSettingAutoSpeakNarration(ttsAvailable && narrationEnabled && value);
  }, [narrationEnabled, preferredTtsProvider, setTtsSettingAutoSpeakNarration, setTtsSettingEnabled, setTtsSettingProvider, ttsAvailable]);

  const persistAudioEnabled = useCallback((value: boolean) => {
    setAudioEnabled(value);
    setAudioSettingEnabled(value);
  }, [setAudioSettingEnabled]);

  const persistMusicEnabled = useCallback((value: boolean) => {
    setMusicEnabled(value);
    setAudioSettingMusicEnabled(value);
  }, [setAudioSettingMusicEnabled]);

  const persistSfxEnabled = useCallback((value: boolean) => {
    setSfxEnabled(value);
    setAudioSettingSfxEnabled(value);
  }, [setAudioSettingSfxEnabled]);

  const persistSillyMode = useCallback((value: boolean) => {
    setSillyMode(value);
    setAudioSettingSillyMode(value);
  }, [setAudioSettingSillyMode]);

  const persistVoiceActionsEnabled = useCallback((value: boolean) => {
    setVoiceActionsEnabled(value);
    setSttSettingEnabled(value);
  }, [setSttSettingEnabled]);

  const persistPreferredGameMode = useCallback((value: GameMode) => {
    setPreferredGameMode(value);
    saveFirstRunPreferences({ preferredGameMode: value });
  }, []);

  useEffect(() => {
    apiFetch('/settings')
      .then(res => res.ok ? res.json() : null)
      .then((settings: AppSettings | null) => {
        if (settings) {
          setImagesEnabled(settings.imagesEnabled);
        }
      })
      .catch(() => { /* keep defaults */ });
  }, []);

  useEffect(() => {
    if (capabilities.hasTts && isMobileBrowser()) {
      setNarrationEnabled(true);
      setAutoSpeakNarration(true);
      setTtsSettingProvider('openai');
      setTtsSettingEnabled(true);
      setTtsSettingAutoSpeakNarration(true);
    }
  }, [capabilities.hasTts, setTtsSettingAutoSpeakNarration, setTtsSettingEnabled, setTtsSettingProvider]);

  const steps = useMemo(() => {
    const base = ['Look', 'Voice', 'Pace', 'Sound'];
    return speechInputSupported ? [...base, 'Mic', 'Review'] : [...base, 'Review'];
  }, [speechInputSupported]);

  const finish = async (afterSave?: () => void) => {
    setSaving(true);
    setError(null);
    try {
      const settingsResponse = await apiFetch('/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imagesEnabled }),
      });
      if (!settingsResponse.ok) {
        throw new Error('Failed to save settings');
      }

      setTtsSettingProvider(preferredTtsProvider);
      setTtsSettingEnabled(ttsAvailable && narrationEnabled);
      setTtsSettingAutoSpeakNarration(ttsAvailable && narrationEnabled && autoSpeakNarration);
      setAudioSettingEnabled(audioEnabled);
      setAudioSettingMusicEnabled(musicEnabled);
      setAudioSettingSfxEnabled(sfxEnabled);
      setAudioSettingSillyMode(sillyMode);
      if (speechInputSupported) {
        setSttSettingEnabled(voiceActionsEnabled);
      }
      saveFirstRunPreferences({ preferredGameMode });
      onComplete();
      afterSave?.();
    } catch {
      setError('Could not save setup choices. Try again in a moment.');
    } finally {
      setSaving(false);
    }
  };

  const next = () => {
    if (step >= steps.length - 1) {
      void finish();
      return;
    }
    setStep(s => s + 1);
  };

  const completeToHome = () => {
    void finish();
  };

  return (
    <div className="fixed inset-0 z-[220] flex items-center justify-center bg-slate-950/95 p-3 text-white backdrop-blur-xl sm:p-5">
      <div className="flex max-h-[96dvh] w-full max-w-6xl flex-col overflow-hidden rounded-[32px] border-2 border-slate-800 bg-slate-950 shadow-2xl md:grid md:min-h-[680px] md:grid-cols-[420px_minmax(0,1fr)] xl:max-w-7xl xl:grid-cols-[480px_minmax(0,1fr)]">
        <div className="relative min-h-[44dvh] overflow-hidden border-b border-slate-800 bg-slate-900 md:min-h-full md:border-b-0 md:border-r">
          <img
            src={assetSrc}
            onError={() => setAssetSrc(imgSrc('/images/dm_thinking.png'))}
            alt=""
            className="absolute inset-0 h-full w-full object-cover animate-ken-burns"
          />
          <div className="absolute bottom-5 left-5 right-5 rounded-2xl bg-slate-950/50 p-3 shadow-2xl backdrop-blur-md md:bottom-7 md:left-7 md:right-7">
            <p className="text-4xl font-display font-black uppercase italic tracking-tighter text-amber-300 drop-shadow-[0_3px_8px_rgba(0,0,0,0.95)] md:text-5xl">First Setup</p>
            <p className="mt-2 max-w-sm text-base font-bold leading-snug text-white drop-shadow-[0_2px_6px_rgba(0,0,0,0.95)]">Pick the adventure feel before the first realm.</p>
          </div>
        </div>

        <div className="flex min-h-0 flex-col">
          <div className="flex items-center justify-between gap-3 border-b border-slate-800 px-5 py-4 md:px-7">
            <div className="flex gap-1">
              {steps.map((label, index) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => setStep(index)}
                  className={`h-2.5 w-10 rounded-full transition-colors ${index === step ? 'bg-amber-500' : index < step ? 'bg-amber-800' : 'bg-slate-800'}`}
                  aria-label={`Go to ${label}`}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={onSkip}
              className="rounded-xl px-3 py-2 text-xs font-black uppercase tracking-widest text-slate-500 transition-colors hover:bg-slate-900 hover:text-slate-300"
            >
              Skip
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 md:px-7 md:py-7">
            {step === 0 && (
              <div className="space-y-4">
                <h2 className="text-2xl font-black uppercase italic tracking-tighter text-white">How should the story look?</h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  <StepButton
                    active={imagesEnabled}
                    title="Images On"
                    description="Scene art and hero portraits for new realms."
                    onClick={() => persistImagesEnabled(true)}
                  />
                  <StepButton
                    active={!imagesEnabled}
                    title="Saving Mode"
                    description="Faster turns and fewer generated images."
                    onClick={() => persistImagesEnabled(false)}
                  />
                </div>
              </div>
            )}

            {step === 1 && (
              <div className="space-y-4">
                <h2 className="text-2xl font-black uppercase italic tracking-tighter text-white">Narration voice</h2>
                {!ttsAvailable ? (
                  <p className="rounded-2xl border-2 border-slate-800 bg-slate-900/70 p-4 text-sm text-slate-400">Narration voice is not available on this device right now.</p>
                ) : (
                  <>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <StepButton
                        active={narrationEnabled}
                        title={capabilities.hasTts ? 'AI Narrator' : 'Browser Voice'}
                        description={capabilities.hasTts ? 'Use the OpenAI narrator for spoken story moments.' : 'Use this device voice for spoken story moments.'}
                        onClick={() => persistNarrationEnabled(true)}
                      />
                      <StepButton
                        active={!narrationEnabled}
                        title="Quiet Reading"
                        description="Keep narration text on screen without voice."
                        onClick={() => persistNarrationEnabled(false)}
                      />
                    </div>
                    {narrationEnabled && (
                      <ToggleRow
                        checked={autoSpeakNarration}
                        label="Read new turns automatically"
                        description="The replay button still works when this is off."
                        onChange={persistAutoSpeakNarration}
                      />
                    )}
                  </>
                )}
              </div>
            )}

            {step === 2 && (
              <div className="space-y-4">
                <h2 className="text-2xl font-black uppercase italic tracking-tighter text-white">Adventure pace</h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  {PACE_OPTIONS.map(option => (
                    <StepButton
                      key={option.id}
                      active={preferredGameMode === option.id}
                      title={option.label}
                      description={option.description}
                      onClick={() => persistPreferredGameMode(option.id)}
                    />
                  ))}
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-3">
                <h2 className="text-2xl font-black uppercase italic tracking-tighter text-white">Table sound</h2>
                <ToggleRow checked={audioEnabled} label="Audio" description="Master switch for music, effects, and narration." onChange={persistAudioEnabled} />
                <ToggleRow checked={musicEnabled} label="Music" description="Ambient tracks during adventures." onChange={persistMusicEnabled} />
                <ToggleRow checked={sfxEnabled} label="Sound effects" description="Dice and action sounds." onChange={persistSfxEnabled} />
                <ToggleRow checked={sillyMode} label="Silly mode" description="Swap in silly effects sometimes." onChange={persistSillyMode} />
              </div>
            )}

            {step === 4 && speechInputSupported && (
              <div className="space-y-4">
                <h2 className="text-2xl font-black uppercase italic tracking-tighter text-white">Voice actions</h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  <StepButton
                    active={voiceActionsEnabled}
                    title="Mic Button On"
                    description="Speak actions into the action dock."
                    onClick={() => persistVoiceActionsEnabled(true)}
                  />
                  <StepButton
                    active={!voiceActionsEnabled}
                    title="Typing Only"
                    description="Use buttons and text input for actions."
                    onClick={() => persistVoiceActionsEnabled(false)}
                  />
                </div>
              </div>
            )}

            {step === steps.length - 1 && (
              <div className="space-y-5">
                <h2 className="text-2xl font-black uppercase italic tracking-tighter text-white">Ready for the table</h2>
                <p className="text-base font-semibold leading-relaxed text-slate-300">
                  These choices set the starting feel for new adventures. You can change voices, audio, images, tutorials, and the first setup wizard later from Settings.
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border-2 border-slate-800 bg-slate-900/70 px-4 py-3">
                    <p className="text-xs font-black uppercase tracking-widest text-amber-300">Images</p>
                    <p className="mt-1 text-sm font-semibold text-white">{imagesEnabled ? 'On for new realms' : 'Saving mode for new realms'}</p>
                  </div>
                  <div className="rounded-2xl border-2 border-slate-800 bg-slate-900/70 px-4 py-3">
                    <p className="text-xs font-black uppercase tracking-widest text-amber-300">Narration</p>
                    <p className="mt-1 text-sm font-semibold text-white">{narrationEnabled && ttsAvailable ? (capabilities.hasTts ? 'AI narrator' : 'Browser voice') : 'Quiet reading'}</p>
                  </div>
                  <div className="rounded-2xl border-2 border-slate-800 bg-slate-900/70 px-4 py-3">
                    <p className="text-xs font-black uppercase tracking-widest text-amber-300">Pace</p>
                    <p className="mt-1 text-sm font-semibold text-white">{PACE_OPTIONS.find(option => option.id === preferredGameMode)?.label}</p>
                  </div>
                  <div className="rounded-2xl border-2 border-slate-800 bg-slate-900/70 px-4 py-3">
                    <p className="text-xs font-black uppercase tracking-widest text-amber-300">Sound</p>
                    <p className="mt-1 text-sm font-semibold text-white">{audioEnabled ? 'Audio enabled' : 'Audio off'}</p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {error && <p className="border-t border-rose-900/50 px-5 py-2 text-sm font-semibold text-rose-300 sm:hidden">{error}</p>}
          <div className="flex items-center gap-3 border-t border-slate-800 px-5 py-4 md:px-7">
            {error && <p className="hidden flex-1 text-sm font-semibold text-rose-300 sm:block">{error}</p>}
            <button
              type="button"
              onClick={() => setStep(s => Math.max(0, s - 1))}
              disabled={step === 0 || saving}
              className="rounded-2xl border-2 border-slate-700 bg-slate-900 px-5 py-3 text-sm font-black uppercase tracking-widest text-slate-300 transition-colors disabled:cursor-not-allowed disabled:opacity-40"
            >
              Back
            </button>
            {step === steps.length - 1 && onStartGetMeRollin && (
              <button
                type="button"
                onClick={() => void finish(onStartGetMeRollin)}
                disabled={saving}
                className="min-h-12 rounded-2xl border-2 border-violet-700 bg-violet-900 px-5 py-3 text-sm font-black uppercase italic tracking-widest text-violet-100 transition-colors hover:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Onboarding
              </button>
            )}
            <button
              type="button"
              onClick={step === steps.length - 1 ? completeToHome : next}
              disabled={saving}
              className="min-h-12 flex-1 rounded-2xl bg-amber-600 px-5 py-3 text-sm font-black uppercase italic tracking-widest text-white shadow-[0_5px_0_rgb(146,64,14)] transition-colors hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? 'Saving...' : step === steps.length - 1 ? "Let's Roll" : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
