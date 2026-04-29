import { useCallback, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { createPortal } from 'react-dom';

// Literal strings required so Tailwind scans all group variants at build time.
const GROUP = {
  default: { wrapper: 'group', hover: 'group-hover:opacity-100' },
  use: { wrapper: 'group/use', hover: 'group-hover/use:opacity-100' },
  give: { wrapper: 'group/give', hover: 'group-hover/give:opacity-100' },
} as const;

interface TooltipProps {
  content: ReactNode;
  position?: 'top' | 'bottom' | 'left';
  align?: 'center' | 'left' | 'right';
  variant?: 'label' | 'description';
  groupName?: keyof typeof GROUP;
  as?: 'div' | 'span';
  portal?: boolean;
  wrapperClassName?: string;
  tooltipClassName?: string;
  children: ReactNode;
}

function tooltipPosClass(position: string, align: string): string {
  if (position === 'top') {
    if (align === 'right') {
      return 'absolute bottom-full right-0 mb-1.5';
    }
    if (align === 'left') {
      return 'absolute bottom-full left-0 mb-1.5';
    }
    return 'absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5';
  }
  if (position === 'left') {
    return 'absolute right-full top-0 mr-2';
  }
  // bottom (default)
  if (align === 'right') {
    return 'absolute top-full right-0 mt-1.5';
  }
  if (align === 'left') {
    return 'absolute top-full left-0 mt-1.5';
  }
  return 'absolute top-full left-1/2 -translate-x-1/2 mt-1.5';
}

function caretPosClass(position: string, align: string): string {
  if (position === 'top') {
    if (align === 'right') {
      return 'absolute top-full right-3 border-4 border-transparent border-t-slate-700';
    }
    return 'absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-700';
  }
  if (position === 'left') {
    return 'absolute top-3 left-full border-4 border-transparent border-l-slate-700';
  }
  // bottom (default)
  if (align === 'right') {
    return 'absolute bottom-full right-3 border-4 border-transparent border-b-slate-700';
  }
  return 'absolute bottom-full left-1/2 -translate-x-1/2 border-4 border-transparent border-b-slate-700';
}

function portalStyle(rect: DOMRect, position: string, align: string): CSSProperties {
  const gap = 6;
  if (position === 'top') {
    const x = align === 'left' ? rect.left : align === 'right' ? rect.right : rect.left + rect.width / 2;
    return {
      top: rect.top - gap,
      left: x,
      transform: align === 'left' ? 'translateY(-100%)' : align === 'right' ? 'translate(-100%, -100%)' : 'translate(-50%, -100%)',
    };
  }

  if (position === 'left') {
    return {
      top: rect.top,
      left: rect.left - gap,
      transform: 'translateX(-100%)',
    };
  }

  const x = align === 'left' ? rect.left : align === 'right' ? rect.right : rect.left + rect.width / 2;
  return {
    top: rect.bottom + gap,
    left: x,
    transform: align === 'left' ? undefined : align === 'right' ? 'translateX(-100%)' : 'translateX(-50%)',
  };
}

export const Tooltip = ({
  content,
  position = 'bottom',
  align = 'center',
  variant = 'label',
  groupName = 'default',
  as = 'span',
  portal = false,
  wrapperClassName = '',
  tooltipClassName = '',
  children,
}: TooltipProps) => {
  const { wrapper, hover } = GROUP[groupName];
  const wrapperRef = useRef<HTMLDivElement & HTMLSpanElement>(null);
  const [portalRect, setPortalRect] = useState<DOMRect | null>(null);
  const variantClass = variant === 'label'
    ? 'px-2 py-1 bg-slate-800 border border-slate-700 rounded-lg text-[10px] font-black uppercase tracking-widest text-white shadow-xl whitespace-nowrap'
    : 'px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-slate-300 shadow-xl';

  const updatePortalRect = useCallback(() => {
    if (portal && wrapperRef.current) {
      setPortalRect(wrapperRef.current.getBoundingClientRect());
    }
  }, [portal]);

  const hidePortal = useCallback(() => {
    if (portal) {
      setPortalRect(null);
    }
  }, [portal]);

  const bubble = content && !portal ? (
    <span className={`${tooltipPosClass(position, align)} ${variantClass} opacity-0 ${hover} transition-opacity pointer-events-none z-50 ${tooltipClassName}`}>
      {content}
      <span className={caretPosClass(position, align)} />
    </span>
  ) : null;

  const portalBubble = content && portal && portalRect && typeof document !== 'undefined'
    ? createPortal(
      <span className={`fixed ${variantClass} pointer-events-none z-[250] ${tooltipClassName}`} style={portalStyle(portalRect, position, align)}>
        {content}
        <span className={caretPosClass(position, align)} />
      </span>,
      document.body,
    )
    : null;

  const wrapClass = `relative ${wrapper}${wrapperClassName ? ` ${wrapperClassName}` : ''}`;
  const wrapProps = {
    ref: wrapperRef,
    className: wrapClass,
    onMouseEnter: updatePortalRect,
    onMouseLeave: hidePortal,
    onFocus: updatePortalRect,
    onBlur: hidePortal,
  };

  if (as === 'div') {
    return <div {...wrapProps}>{children}{bubble}{portalBubble}</div>;
  }
  return <span {...wrapProps}>{children}{bubble}{portalBubble}</span>;
};
