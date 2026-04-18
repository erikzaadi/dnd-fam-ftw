import { useSearchParams } from 'react-router-dom';
import { imgSrc, apiUrl } from '../lib/api';

export const Login = () => {
  const [searchParams] = useSearchParams();
  const unauthorized = searchParams.get('error') === 'unauthorized';

  const handleLogin = () => {
    window.location.href = apiUrl('/auth/google');
  };

  return (
    <div className="h-screen bg-slate-950 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900 via-slate-950 to-slate-950 text-white flex flex-col overflow-hidden">
      {/* Banner */}
      <div className="flex-shrink-0">
        <div className="relative mt-4 mx-4 md:mx-6 h-52 md:h-64 rounded-[24px] overflow-hidden border border-slate-800/60 shadow-2xl">
          <img
            src={imgSrc('/images/home_banner.png')}
            className="w-full h-full object-cover animate-ken-burns"
            alt=""
          />
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-slate-950/30 to-transparent" />
          <div className="absolute bottom-0 left-0 right-0 flex items-end justify-center pb-6 pointer-events-none">
            <div className="font-display font-black text-amber-400 italic tracking-tighter text-5xl md:text-7xl drop-shadow-[0_2px_12px_rgba(0,0,0,0.9)]">
              🐉 AI DM
            </div>
          </div>
        </div>
      </div>

      {/* Login card */}
      <div className="flex-1 flex items-center justify-center px-4">
        <div className="bg-slate-900/80 border-2 border-slate-800 rounded-[32px] p-8 max-w-sm w-full space-y-6 text-center">
          <div>
            <h2 className="text-2xl font-display font-black text-amber-400 italic tracking-tighter">Welcome, Adventurer</h2>
            <p className="text-slate-400 text-sm mt-2">Sign in to access your party and worlds.</p>
          </div>

          {unauthorized && (
            <div className="bg-rose-950/60 border border-rose-800/60 rounded-2xl px-4 py-3 text-rose-300 text-sm">
              That Google account isn't on the guest list. Ask the DM to add you.
            </div>
          )}

          <button
            onClick={handleLogin}
            className="w-full py-4 bg-white hover:bg-slate-100 rounded-[20px] font-black uppercase italic tracking-tighter transition-colors shadow-[0_4px_0_rgb(203,213,225)] text-slate-900 flex items-center justify-center gap-3"
          >
            <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            Sign in with Google
          </button>

          <p className="text-slate-600 text-xs">This is a private server. Access is by invite only.</p>
        </div>
      </div>
    </div>
  );
};
