
import { useParams, useNavigate } from 'react-router-dom';
import { useTtsSettings } from '../tts/useTtsSettings';
import { useSttSettings } from '../stt/useSttSettings';
import { useCapabilities } from '../hooks/useCapabilities';
import { useCarSessionRuntime } from '../session/car/useCarSessionRuntime';
import { useCarConductor } from '../session/car/useCarConductor';
import { SiteHeader } from '../components/SiteHeader';
import { DmFooter } from '../components/DmFooter';

export const CarMode = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { settings: ttsSettings, setEnabled: setTtsEnabled } = useTtsSettings();
  const { settings: sttSettings, setEnabled: setSttEnabled } = useSttSettings();
  const { capabilities } = useCapabilities();

  // If either narration voice or voice actions is disabled, we render setup view.
  const needsSetup = !ttsSettings.enabled || !sttSettings.enabled;

  const {
    session,
    history,
    loading,
    actionError,
    connectionState,
    prevEncounterStatus,
    submitAction,
    previewAction,
    actionPreview,
    clearPreview,
    previewThinking,
  } = useCarSessionRuntime({
    sessionId: id || '',
    onTurnComplete: () => {},
    onTurnError: () => {},
    onConnected: () => {},
    onNarrating: () => {},
  });

  const {
    conductorState,
    isPaused,
    transcriptLog,
    pauseConductor,
    resumeConductor,
    speakFullStorySequence,
    speakOptionsAndPrompt,
    sttError,
    recognizedTranscript,
  } = useCarConductor({
    session,
    history,
    loading: loading || needsSetup,
    connectionState,
    prevEncounterStatus,
    actionPreview,
    previewThinking,
    submitAction,
    previewAction,
    clearPreview,
    ttsSettings,
    hasTts: capabilities.hasTts,
  });

  if (!id) {
    return null;
  }

  const handleExit = () => {
    navigate(`/session/${id}`);
  };

  // Blocking Setup View
  if (needsSetup) {
    return (
      <div className="h-screen bg-slate-950 text-white flex flex-col overflow-hidden">
        <SiteHeader />
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center max-w-md mx-auto space-y-8">
          <div>
            <h2 className="text-3xl font-display font-black text-amber-400 italic tracking-tighter uppercase">
              Voice Setup Required
            </h2>
            <p className="text-slate-400 text-sm mt-3 leading-relaxed">
              Hands-free Car Mode requires both Text-to-Speech (narration) and Speech-to-Text (voice action) to be active.
            </p>
          </div>

          <div className="w-full space-y-4">
            <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl flex items-center justify-between">
              <div className="text-left">
                <div className="font-bold text-slate-200">Narration Voice</div>
                <div className="text-xs text-slate-500">{ttsSettings.enabled ? 'Enabled' : 'Disabled'}</div>
              </div>
              <button
                onClick={() => setTtsEnabled(!ttsSettings.enabled)}
                className={`px-5 py-2.5 rounded-xl font-bold text-sm tracking-tight cursor-pointer transition-colors ${
                  ttsSettings.enabled
                    ? 'bg-emerald-500 hover:bg-emerald-600 text-white'
                    : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                }`}
              >
                {ttsSettings.enabled ? 'Disable' : 'Enable'}
              </button>
            </div>

            <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl flex items-center justify-between">
              <div className="text-left">
                <div className="font-bold text-slate-200">Voice Actions (STT)</div>
                <div className="text-xs text-slate-500">{sttSettings.enabled ? 'Enabled' : 'Disabled'}</div>
              </div>
              <button
                onClick={() => setSttEnabled(!sttSettings.enabled)}
                className={`px-5 py-2.5 rounded-xl font-bold text-sm tracking-tight cursor-pointer transition-colors ${
                  sttSettings.enabled
                    ? 'bg-emerald-500 hover:bg-emerald-600 text-white'
                    : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                }`}
              >
                {sttSettings.enabled ? 'Disable' : 'Enable'}
              </button>
            </div>
          </div>

          <button
            onClick={handleExit}
            className="w-full py-4 bg-slate-800 hover:bg-slate-700 rounded-2xl font-bold tracking-tight cursor-pointer text-slate-200 transition-colors"
          >
            Exit to Standard Mode
          </button>
        </div>
        <DmFooter />
      </div>
    );
  }

  // Helper to color/style based on current state
  const stateConfig = {
    idle: { bg: 'bg-slate-800', border: 'border-slate-700', text: 'Paused', label: 'PAUSED', color: 'text-slate-400' },
    speaking: { bg: 'bg-blue-600/20', border: 'border-blue-500', text: 'Narrating...', label: 'SPEAKING', color: 'text-blue-400' },
    listening: { bg: 'bg-emerald-600/20', border: 'border-emerald-500 animate-pulse', text: 'Listening...', label: 'LISTENING', color: 'text-emerald-400' },
    processing: { bg: 'bg-amber-600/20', border: 'border-amber-500', text: 'DM is thinking...', label: 'PROCESSING', color: 'text-amber-400' },
    confirming: { bg: 'bg-amber-600/20', border: 'border-amber-500', text: 'Waiting for confirm...', label: 'CONFIRMING', color: 'text-amber-400' },
    submitting: { bg: 'bg-amber-600/20', border: 'border-amber-500', text: 'Submitting action...', label: 'SUBMITTING', color: 'text-amber-400' },
    error: { bg: 'bg-rose-600/20', border: 'border-rose-500', text: 'Voice Error', label: 'ERROR', color: 'text-rose-400' },
    reconnecting: { bg: 'bg-rose-600/20', border: 'border-rose-500 animate-pulse', text: 'Reconnecting...', label: 'RECONNECTING', color: 'text-rose-400' },
  }[conductorState];

  return (
    <div className="h-screen bg-slate-950 text-white flex flex-col overflow-hidden">
      <SiteHeader />

      <div className="flex-1 flex flex-col px-6 py-4 overflow-y-auto space-y-6">
        {/* Realm Header Info */}
        <div className="text-center">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-400/10 text-amber-400 border border-amber-400/20 tracking-wider uppercase mb-1">
            Car Mode Active
          </span>
          <h2 className="text-2xl font-display font-black tracking-tight leading-tight truncate">
            {session?.displayName || 'Loading Realm...'}
          </h2>
          <p className="text-slate-500 text-xs mt-0.5">
            Active Scene: <span className="text-slate-300 font-medium">{session?.scene || 'Unknown'}</span>
          </p>
        </div>

        {/* State Display Sphere */}
        <div className="flex-1 flex flex-col items-center justify-center space-y-4">
          <div
            onClick={isPaused ? resumeConductor : pauseConductor}
            className={`w-44 h-44 rounded-full border-4 flex flex-col items-center justify-center cursor-pointer transition-all duration-300 transform active:scale-95 shadow-lg ${stateConfig.bg} ${stateConfig.border}`}
          >
            {isPaused ? (
              <svg className="w-16 h-16 text-slate-400" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            ) : conductorState === 'speaking' ? (
              <svg className="w-16 h-16 text-blue-400" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 3v18c5-4.5 5-13.5 0-18z" />
              </svg>
            ) : conductorState === 'listening' ? (
              <svg className="w-16 h-16 text-emerald-400" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z" />
              </svg>
            ) : conductorState === 'processing' || conductorState === 'submitting' ? (
              <div className="w-12 h-12 border-4 border-amber-500 border-t-transparent rounded-full animate-spin" />
            ) : conductorState === 'reconnecting' ? (
              <div className="w-12 h-12 border-4 border-rose-500 border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg className="w-16 h-16 text-slate-400" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
              </svg>
            )}
            <span className={`text-xs font-black tracking-wider uppercase mt-3 ${stateConfig.color}`}>
              {stateConfig.label}
            </span>
          </div>

          {/* Animated Waveform */}
          {!isPaused && (conductorState === 'speaking' || conductorState === 'listening') && (
            <div className="flex items-center gap-1.5 h-6">
              {[...Array(6)].map((_, i) => (
                <div
                  key={i}
                  className={`w-1 rounded-full transition-all duration-300 ${
                    conductorState === 'speaking' ? 'bg-blue-500 animate-[bounce_1s_infinite]' : 'bg-emerald-500 animate-[bounce_0.8s_infinite]'
                  }`}
                  style={{
                    height: '24px',
                    animationDelay: `${i * 0.15}s`,
                  }}
                />
              ))}
            </div>
          )}

          {/* Context Details Readout */}
          <div className="text-center max-w-sm px-4">
            {recognizedTranscript && (
              <p className="text-emerald-400 text-sm font-semibold italic animate-pulse">
                Hearing: "{recognizedTranscript}"
              </p>
            )}
            {!recognizedTranscript && actionPreview && (
              <p className="text-amber-400 text-sm font-semibold">
                Confirming: "{actionPreview.interpretedAction}"
              </p>
            )}
            {!recognizedTranscript && !actionPreview && (
              <p className="text-slate-400 text-sm leading-relaxed">
                {stateConfig.text}
              </p>
            )}
          </div>
        </div>

        {/* Global Warnings or Errors */}
        {(actionError || sttError) && (
          <div className="bg-rose-950/50 border border-rose-800/80 px-4 py-3 rounded-2xl text-rose-300 text-xs flex items-start gap-2.5">
            <svg className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
            </svg>
            <div>
              <div className="font-bold">Voice Mode Alert</div>
              <div className="mt-0.5">{actionError || sttError}</div>
            </div>
          </div>
        )}

        {/* Tactile Operations Dock */}
        <div className="grid grid-cols-2 gap-4">
          <button
            onClick={isPaused ? resumeConductor : pauseConductor}
            className={`py-5 rounded-3xl font-black uppercase italic tracking-tighter text-base flex flex-col items-center justify-center gap-1.5 shadow-md cursor-pointer transition-all duration-200 active:scale-95 ${
              isPaused
                ? 'bg-emerald-500 text-white shadow-[0_4px_0_rgb(16,185,129)]'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-200 shadow-[0_4px_0_rgb(51,65,85)]'
            }`}
          >
            {isPaused ? (
              <>
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
                Resume Voice
              </>
            ) : (
              <>
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                </svg>
                Pause Voice
              </>
            )}
          </button>

          <button
            onClick={speakOptionsAndPrompt}
            disabled={isPaused}
            className="py-5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 disabled:pointer-events-none text-slate-200 rounded-3xl font-black uppercase italic tracking-tighter text-base flex flex-col items-center justify-center gap-1.5 shadow-[0_4px_0_rgb(51,65,85)] cursor-pointer transition-all duration-200 active:scale-95"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M19 8H5v2h14V8zm0 6H5v2h14v-2z" />
            </svg>
            Repeat Options
          </button>

          <button
            onClick={speakFullStorySequence}
            disabled={isPaused}
            className="py-5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 disabled:pointer-events-none text-slate-200 rounded-3xl font-black uppercase italic tracking-tighter text-base flex flex-col items-center justify-center gap-1.5 shadow-[0_4px_0_rgb(51,65,85)] cursor-pointer transition-all duration-200 active:scale-95"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z" />
            </svg>
            Repeat Story
          </button>

          <button
            onClick={handleExit}
            className="py-5 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-400 rounded-3xl font-black uppercase italic tracking-tighter text-base flex flex-col items-center justify-center gap-1.5 shadow-[0_4px_0_rgb(15,23,42)] cursor-pointer transition-all duration-200 active:scale-95"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M10.09 15.59L11.5 17l5-5-5-5-1.41 1.41L12.67 11H3v2h9.67l-2.58 2.59zM19 3H5c-1.11 0-2 .9-2 2v4h2V5h14v14H5v-4H3v4c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z" />
            </svg>
            Exit Car Mode
          </button>
        </div>

        {/* Scrollable voice transcript display log */}
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4 flex-1 min-h-[140px] flex flex-col">
          <div className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Recent Voice Logs</div>
          <div className="flex-1 overflow-y-auto space-y-1.5 text-sm font-mono scrollbar-thin">
            {transcriptLog.length === 0 ? (
              <p className="text-slate-600 italic">No logs recorded yet. Speak a command to start.</p>
            ) : (
              transcriptLog.map((log, index) => {
                const isUser = log.startsWith('You:');
                const isSystem = log.startsWith('System:');
                const isInterpreted = log.startsWith('Interpreted:');
                let textColor = 'text-slate-300';
                if (isUser) {
                  textColor = 'text-emerald-400 font-bold';
                } else if (isSystem) {
                  textColor = 'text-slate-500';
                } else if (isInterpreted) {
                  textColor = 'text-amber-400';
                }
                return (
                  <div key={index} className={`${textColor} leading-normal`}>
                    {log}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
      <DmFooter />
    </div>
  );
};
