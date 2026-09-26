import { useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Home } from './pages/Home';
import { SessionPage } from './pages/Session';
import { CarMode } from './pages/CarMode';
import { TerminalMode } from './pages/TerminalMode';
import { CreateSession } from './pages/CreateSession';
import { CharacterAssembly } from './pages/CharacterAssembly';
import { SessionRecap } from './pages/SessionRecap';
import { Settings } from './pages/Settings';
import { AccessTokens } from './pages/AccessTokens';
import { HowToPlay } from './pages/HowToPlay';
import { GetMeRollin } from './pages/GetMeRollin';
import { Login } from './pages/Login';
import { NamespacePicker } from './pages/NamespacePicker';
import { RequestInvite } from './pages/RequestInvite';
import { VerifyEmail } from './pages/VerifyEmail';
import { AcceptInvite } from './pages/AcceptInvite';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { AudioUnlockOverlay } from './components/AudioUnlockOverlay';

function AuthUnavailable({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="h-screen bg-slate-950 text-white flex items-center justify-center px-4">
      <div className="bg-slate-900/80 border-2 border-slate-800 rounded-[32px] p-8 max-w-sm w-full space-y-4 text-center">
        <h2 className="text-2xl font-display font-black text-amber-400 italic tracking-tighter">The realm gate is stuck</h2>
        <p className="text-slate-400 text-sm">We couldn't reach the realm's gatekeeper. Check your connection and try again.</p>
        <button
          onClick={onRetry}
          className="w-full py-3 bg-amber-500 hover:bg-amber-400 rounded-[20px] font-black uppercase italic tracking-tighter text-slate-950 transition-colors cursor-pointer"
        >
          Try again
        </button>
      </div>
    </div>
  );
}

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { enabled, user, loading, unavailable, namespaceLost, refetch } = useAuth();

  if (loading) {
    return (
      <div className="h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-amber-400 text-2xl font-display font-black italic animate-pulse">🐉</div>
      </div>
    );
  }

  if (unavailable) {
    return <AuthUnavailable onRetry={() => void refetch()} />;
  }

  if (enabled && !user && namespaceLost) {
    return <Navigate to="/namespace-picker" replace />;
  }

  if (enabled && !user) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

function AppRoutes() {
  return (
    <AuthGuard>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/access-tokens" element={<AccessTokens />} />
        <Route path="/how-to-play" element={<HowToPlay />} />
        <Route path="/get-me-rollin" element={<GetMeRollin />} />
        <Route path="/create-session" element={<CreateSession />} />
        <Route path="/session/:id" element={<SessionPage />} />
        <Route path="/session/:id/car" element={<CarMode />} />
        <Route path="/session/:id/terminal" element={<TerminalMode />} />
        <Route path="/session/:id/recap" element={<SessionRecap />} />
        <Route path="/session/:id/assembly" element={<CharacterAssembly />} />
      </Routes>
    </AuthGuard>
  );
}

import { useAudioSettings } from './audio/useAudioSettings';
import { audioManager } from './audio/audioManager';

function App() {
  const { settings } = useAudioSettings();
  const location = useLocation();

  useEffect(() => {
    audioManager.updateSettings(settings);
  }, [settings]);

  useEffect(() => {
    const isMusicRoute =
      location.pathname === '/' ||
      location.pathname === '/create-session' ||
      location.pathname.includes('/session/');

    if (!isMusicRoute) {
      audioManager.stopMusic();
    }
  }, [location.pathname]);

  useEffect(() => {
    audioManager.unlockOnFirstGesture();
  }, []);

  return (
    <AuthProvider>
      <AudioUnlockOverlay />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/verify-email" element={<VerifyEmail />} />
        <Route path="/namespace-picker" element={<NamespacePicker />} />
        <Route path="/request-invite" element={<RequestInvite />} />
        <Route path="/accept-invite" element={<AcceptInvite />} />
        <Route path="/*" element={<AppRoutes />} />
      </Routes>
    </AuthProvider>
  );
}

export default App;
