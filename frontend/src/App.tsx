import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Home } from './pages/Home';
import { SessionPage } from './pages/Session';
import { CreateSession } from './pages/CreateSession';
import { CharacterAssembly } from './pages/CharacterAssembly';
import { SessionRecap } from './pages/SessionRecap';
import { Settings } from './pages/Settings';
import { HowToPlay } from './pages/HowToPlay';
import { Login } from './pages/Login';
import { NamespacePicker } from './pages/NamespacePicker';
import { RequestInvite } from './pages/RequestInvite';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { AudioUnlockOverlay } from './components/AudioUnlockOverlay';

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { enabled, user, loading } = useAuth();

  if (loading) {
    return (
      <div className="h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-amber-400 text-2xl font-display font-black italic animate-pulse">🐉</div>
      </div>
    );
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
        <Route path="/how-to-play" element={<HowToPlay />} />
        <Route path="/create-session" element={<CreateSession />} />
        <Route path="/session/:id" element={<SessionPage />} />
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  useEffect(() => {
    audioManager.unlockOnFirstGesture();
  }, []);

  return (
    <AuthProvider>
      <AudioUnlockOverlay />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/namespace-picker" element={<NamespacePicker />} />
        <Route path="/request-invite" element={<RequestInvite />} />
        <Route path="/*" element={<AppRoutes />} />
      </Routes>
    </AuthProvider>
  );
}

export default App;
