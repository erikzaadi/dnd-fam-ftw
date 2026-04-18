import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { imgSrc } from '../lib/api';
import { FullscreenImage } from './FullscreenImage';
import { useAuth } from '../contexts/AuthContext';

export const SiteHeader = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const isHome = location.pathname === '/';
  const [fullscreen, setFullscreen] = useState(false);
  const { enabled, user, logout } = useAuth();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="flex-shrink-0">
      {fullscreen && <FullscreenImage url={imgSrc('/images/home_banner.png')} onClose={() => setFullscreen(false)} />}
      <div
        className={`relative mt-4 mx-4 md:mx-6 ${isHome ? 'h-40 md:h-52' : 'h-32 md:h-40'} rounded-[24px] overflow-hidden border border-slate-800/60 shadow-2xl cursor-zoom-in`}
        onClick={() => setFullscreen(true)}
      >
        {!isHome && (
          <button
            onClick={e => {
              e.stopPropagation(); navigate('/');
            }}
            className="absolute top-3 left-3 z-10 text-slate-300 hover:text-white bg-slate-950/60 backdrop-blur-sm rounded-full w-9 h-9 flex items-center justify-center transition-colors"
            aria-label="Back to home"
          >
            ←
          </button>
        )}
        {enabled && user && (
          <button
            onClick={e => {
              e.stopPropagation(); void handleLogout(); 
            }}
            title={`Signed in as ${user.email}`}
            className="absolute top-3 right-3 z-10 text-slate-300 hover:text-white bg-slate-950/60 backdrop-blur-sm rounded-full px-3 h-9 flex items-center gap-1.5 text-xs font-bold transition-colors"
            aria-label="Sign out"
          >
            <span className="hidden sm:inline truncate max-w-[120px]">{user.email.split('@')[0]}</span>
            <span>↩</span>
          </button>
        )}
        <img src={imgSrc('/images/home_banner.png')} className="w-full h-full object-cover animate-ken-burns" alt="" />
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-slate-950/20 to-transparent" />
        {isHome && (
          <div className="absolute bottom-0 left-0 right-0 flex items-end justify-center pb-4 pointer-events-none">
            <div className="font-display font-black text-amber-400 italic tracking-tighter text-5xl md:text-7xl drop-shadow-[0_2px_12px_rgba(0,0,0,0.9)]">
              🐉 AI DM
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
