import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';

interface MenuItemProps {
  icon: ReactNode;
  label: string;
  onClick?: () => void;
  /** Highlights item in amber - for active/toggled state */
  active?: boolean;
  /** Subdued text color - for secondary/navigation links */
  dimmed?: boolean;
  /** Renders as a react-router Link instead of button */
  to?: string;
}

const BASE = 'flex items-center gap-3 w-full px-3 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all';

export const MenuItem = ({ icon, label, onClick, active, dimmed, to }: MenuItemProps) => {
  const colorClass = active
    ? 'bg-amber-500/10 text-amber-400'
    : dimmed
      ? 'text-slate-500 hover:bg-slate-800 hover:text-slate-300'
      : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200';
  const className = `${BASE} ${colorClass}`;
  const content = (
    <>
      <span className="text-base">{icon}</span>
      {label}
    </>
  );

  if (to) {
    return (
      <Link to={to} onClick={onClick} className={className}>
        {content}
      </Link>
    );
  }
  return (
    <button onClick={onClick} className={className}>
      {content}
    </button>
  );
};
