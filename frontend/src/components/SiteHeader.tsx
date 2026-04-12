import { useNavigate, useLocation } from 'react-router-dom';

export const SiteHeader = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const isHome = location.pathname === '/';

  return (
    <div className="fixed top-0 left-0 right-0 z-[20] flex items-center gap-4 px-6 h-14 bg-slate-950/80 backdrop-blur-md border-b border-slate-800/50">
      {!isHome && (
        <button
          onClick={() => navigate('/')}
          className="text-slate-400 hover:text-white transition-colors text-xl leading-none"
          aria-label="Back to home"
        >
          ←
        </button>
      )}
      <span
        className="font-display font-black text-amber-500 italic tracking-tighter text-xl cursor-pointer"
        onClick={() => navigate('/')}
      >
        🐉 AI DM
      </span>
    </div>
  );
};
