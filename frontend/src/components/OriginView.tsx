import { useState, useEffect } from 'react';
import type { Session } from '../types';
import { apiFetch, imgSrc } from '../lib/api';
import { useTtsSettings } from '../tts/useTtsSettings';
import { narrationTtsService } from '../tts/narrationTtsService';
import { NarrationTtsButton } from './NarrationTtsButton';

interface OriginViewProps {
  sessionId: string;
  session: Session;
  onEnter: () => void;
  hasTts: boolean;
}

export const OriginView = ({ sessionId, session, onEnter, hasTts }: OriginViewProps) => {
  const [originStory, setOriginStory] = useState<string | null>(session.originStory ?? null);
  const [generating, setGenerating] = useState(false);
  const { settings: ttsSettings } = useTtsSettings();
  const previewImageUrl = session.previewImageUrl ? imgSrc(session.previewImageUrl) : imgSrc('/images/default_scene.png');

  useEffect(() => {
    if (originStory || !session.party.length) {
      return;
    }
    setGenerating(true);
    const load = async () => {
      try {
        const getRes = await apiFetch(`/session/${sessionId}/origin-story`);
        const getData = await getRes.json() as { originStory: string | null };
        if (getData.originStory) {
          setOriginStory(getData.originStory);
        } else {
          const postRes = await apiFetch(`/session/${sessionId}/origin-story`, { method: 'POST' });
          const postData = await postRes.json() as { originStory: string };
          setOriginStory(postData.originStory);
        }
      } catch {
        // continue without origin story
      } finally {
        setGenerating(false);
      }
    };
    void load();
  }, [sessionId, session.party.length, originStory]);

  useEffect(() => {
    if (!originStory || !narrationTtsService.isNarrationAvailable(ttsSettings, hasTts, true)) {
      return;
    }
    narrationTtsService.speakNarration({
      text: originStory,
      settings: ttsSettings,
      hasTts,
      turnId: `origin:${sessionId}`,
      mainNarration: true,
    });
    return () => {
      narrationTtsService.stopNarration();
    };
  }, [originStory, ttsSettings, hasTts, sessionId]);

  return (
    <div className="flex-1 flex flex-col min-h-0 relative animate-in fade-in duration-500">
      <img src={previewImageUrl} alt="" className="absolute inset-0 w-full h-full object-cover opacity-30 animate-ken-burns" />
      <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/70 to-slate-950/30" />
      <div className="relative flex-1 overflow-y-auto overscroll-y-contain">
        <div className="min-h-full flex flex-col items-center justify-center gap-8 px-6 md:px-16 py-12">
          <h2 className="text-3xl md:text-4xl font-display font-black text-amber-500 uppercase tracking-widest text-center">How It Began</h2>
          {generating && !originStory ? (
            <p className="text-amber-500 animate-pulse font-black uppercase tracking-widest text-lg">Weaving the tale...</p>
          ) : originStory ? (
            <div className="w-full max-w-6xl flex flex-col gap-4">
              <div className="bg-slate-950/80 rounded-[24px] border border-slate-800 p-8 md:p-12">
                {originStory.split('\n\n').map((para, i) => (
                  <p key={i} className={`font-narrative text-3xl md:text-4xl text-slate-200 leading-relaxed italic${i > 0 ? ' mt-6' : ''}`}>{para}</p>
                ))}
              </div>
              <NarrationTtsButton text={originStory} ttsSettings={ttsSettings} hasTts={hasTts} turnId={`origin:${sessionId}`} className="justify-center" />
            </div>
          ) : null}
          <div className="flex flex-col items-center gap-4">
            {!session.gameOver && (
              <button
                onClick={onEnter}
                disabled={generating && !originStory}
                className="px-12 py-5 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 rounded-[28px] font-black uppercase italic tracking-tighter text-2xl shadow-[0_8px_0_rgb(146,64,14)] transition-all"
              >
                Begin Adventure
              </button>
            )}
            <button onClick={onEnter} className="text-slate-500 hover:text-slate-300 font-black uppercase text-xs tracking-widest transition-colors">
              {session.gameOver ? 'View Chronicle' : 'Skip'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
