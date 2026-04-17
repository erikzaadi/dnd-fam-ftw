import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { imgSrc } from '../lib/api';
import { FullscreenImage } from './FullscreenImage';

export const SiteHeader = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const isHome = location.pathname === '/';
  const [fullscreen, setFullscreen] = useState(false);

  return (
    <div className="flex-shrink-0 flex flex-col">
      {fullscreen && <FullscreenImage url={imgSrc('/api/images/home_banner.png')} onClose={() => setFullscreen(false)} />}
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
        <img src={imgSrc('/api/images/home_banner.png')} className="w-full h-full object-cover animate-ken-burns" alt="" />
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950/60 to-transparent" />
      </div>
      <div className="px-4 md:px-6 pt-4">
        <div className="font-display font-black text-amber-500 italic tracking-tighter text-4xl md:text-5xl text-center">🐉 AI DM</div>
      </div>
    </div>
  );
};
