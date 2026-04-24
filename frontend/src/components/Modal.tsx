import type { ReactNode, MouseEventHandler } from 'react';

interface ModalProps {
  children: ReactNode;
  /** CSS z-index value. Default: 200. */
  zIndex?: number;
  /** Extra classes appended to the backdrop div. */
  className?: string;
  onClick?: MouseEventHandler<HTMLDivElement>;
}

/**
 * Full-screen backdrop wrapper used by all overlay modals.
 * Renders: fixed inset-0, dark blurred backdrop, centered content.
 */
export const Modal = ({ children, zIndex = 200, className, onClick }: ModalProps) => (
  <div
    style={{ zIndex }}
    className={`fixed inset-0 bg-black/80 backdrop-blur-xl flex items-center justify-center p-4${className ? ` ${className}` : ''}`}
    onClick={onClick}
  >
    {children}
  </div>
);
