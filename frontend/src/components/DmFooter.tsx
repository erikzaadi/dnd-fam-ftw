import { imgSrc } from '../lib/api';

export const DmFooter = () => (
  <div className="fixed bottom-0 left-0 right-0 h-[180px] pointer-events-none z-[5] overflow-hidden">
    <img
      src={imgSrc('/api/images/dm_thinking.png')}
      className="absolute inset-0 w-full h-full object-cover object-center opacity-50"
      aria-hidden="true"
    />
    <div className="absolute inset-0 bg-gradient-to-b from-slate-950 via-slate-950/50 to-transparent" />
  </div>
);
