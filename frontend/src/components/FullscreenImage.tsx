import { useEffect } from 'react';

interface FullscreenImageProps {
  url: string;
  onClose: () => void;
}

export const FullscreenImage = ({ url, onClose }: FullscreenImageProps) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') {onClose();} };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[300] bg-black/95 flex items-center justify-center p-4 cursor-zoom-out" onClick={onClose}>
      <img src={url} className="max-w-full max-h-full object-contain" alt="Fullscreen" />
      <button onClick={onClose} className="absolute top-6 right-6 text-white text-3xl">✕</button>
    </div>
  );
};
