import { Routes, Route } from 'react-router-dom';
import { Home } from './pages/Home';
import { SessionPage } from './pages/Session';
import { CreateSession } from './pages/CreateSession';
import { CharacterAssembly } from './pages/CharacterAssembly';
import { SessionRecap } from './pages/SessionRecap';
import { Settings } from './pages/Settings';

function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/settings" element={<Settings />} />
      <Route path="/create-session" element={<CreateSession />} />
      <Route path="/session/:id" element={<SessionPage />} />
      <Route path="/session/:id/recap" element={<SessionRecap />} />
      <Route path="/session/:id/assembly" element={<CharacterAssembly />} />
    </Routes>
  );
}

export default App;
