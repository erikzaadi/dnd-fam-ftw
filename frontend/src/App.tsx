import { Routes, Route, Navigate } from 'react-router-dom';
import { Home } from './pages/Home';
import { SessionPage } from './pages/Session';
import { CreateSession } from './pages/CreateSession';
import { CharacterAssembly } from './pages/CharacterAssembly';
import { SessionRecap } from './pages/SessionRecap';
import { Settings } from './pages/Settings';
import { HowToPlay } from './pages/HowToPlay';
import { Login } from './pages/Login';
import { AuthProvider, useAuth } from './contexts/AuthContext';

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

function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/*" element={<AppRoutes />} />
      </Routes>
    </AuthProvider>
  );
}

export default App;
