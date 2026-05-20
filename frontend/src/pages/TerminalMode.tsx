import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useCarSessionRuntime } from '../session/car/useCarSessionRuntime';
import { parseSpeechIntent } from '../stt/speechIntent';
import {
  buildRollResultSegment,
  buildNarrationSegment,
  buildEncounterBoundarySegment,
  buildActiveCharacterSegment,
  buildGearSegment,
  buildStatusSegment,
  buildPartySegment,
  buildLocationSegment,
} from '../session/car/carSpeechSegment';
import { imgSrc } from '../lib/api';


interface TerminalEntry {
  id: string;
  type: 'narration' | 'system' | 'command' | 'result' | 'error';
  text: string;
  imageUrl?: string;
}

export const TerminalMode: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [log, setLog] = useState<TerminalEntry[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [actionPreviewText, setActionPreviewText] = useState<string | null>(null);
  const [activeImageUrl, setActiveImageUrl] = useState<string | null>(null);
  const [isFullscreenMode, setIsFullscreenMode] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const shouldScrollRef = useRef(false);
  const hasInitializedRef = useRef(false);
  const prevEncounterStatusRef = useRef<string>('none');

  const addLogEntry = useCallback((type: TerminalEntry['type'], text: string, imageUrl?: string) => {
    setLog(prev => [
      ...prev,
      {
        id: `${Date.now()}-${Math.random()}`,
        type,
        text,
        imageUrl,
      },
    ]);
  }, []);

  const toggleFullscreenMode = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch((err) => {
        console.warn('Failed to enter fullscreen:', err);
      });
    } else {
      document.exitFullscreen?.().catch((err) => {
        console.warn('Failed to exit fullscreen:', err);
      });
    }
  }, []);

  const {
    session,
    history,
    loading,
    actionError: _actionError,
    connectionState,
    prevEncounterStatus,
    submitAction,
    previewAction,
    actionPreview,
    clearPreview,
    previewThinking,
  } = useCarSessionRuntime({
    sessionId: id || '',
    onTurnComplete: (updatedSession, turn) => {
      setActionPreviewText(null);
      clearPreview();

      const rollSeg = buildRollResultSegment(turn);
      if (rollSeg) {
        addLogEntry('result', rollSeg);
      }

      const currentEncounterStatus = updatedSession?.encounterState?.status || 'none';
      const boundarySeg = buildEncounterBoundarySegment(
        prevEncounterStatusRef.current,
        currentEncounterStatus,
        updatedSession?.encounterState?.name,
        updatedSession?.encounterState?.status !== 'active' ? turn.narration : undefined
      );
      if (boundarySeg) {
        addLogEntry('system', boundarySeg);
      }

      const narrSeg = buildNarrationSegment(turn);
      if (narrSeg) {
        addLogEntry('narration', narrSeg);
      }

      const activeCharSeg = buildActiveCharacterSegment(updatedSession);
      if (activeCharSeg) {
        addLogEntry('system', activeCharSeg);
      }

      if (turn.choices && turn.choices.length > 0) {
        turn.choices.forEach((choice, idx) => {
          addLogEntry('system', `${idx + 1}. ${choice.label}`);
        });
      }

      prevEncounterStatusRef.current = currentEncounterStatus;
      shouldScrollRef.current = true;
    },
    onTurnError: (_error, message) => {
      addLogEntry('error', `Action failed: ${message}`);
      shouldScrollRef.current = true;
    },
    onConnected: () => {
      addLogEntry('system', 'Connected to game feed.');
      shouldScrollRef.current = true;
    },
    onNarrating: () => {
      addLogEntry('system', 'DM is thinking...');
      shouldScrollRef.current = true;
    },
    onImageReady: (imageUrl) => {
      addLogEntry('system', '[Turn image ready - click to view]', imageUrl);
      shouldScrollRef.current = true;
    },
    onPreviewReady: (preview) => {
      addLogEntry('system', `Interpreted: ${preview.interpretedAction}`);
      addLogEntry('system', `Roll: ${preview.stat} (difficulty: ${preview.difficulty})`);
      if (preview.warnings && preview.warnings.length > 0) {
        preview.warnings.forEach(w => {
          addLogEntry('system', `Warning: ${w}`);
        });
      }
      addLogEntry('system', `Type 'confirm' to execute, 'cancel' to abort, or 'retry [action]' to change.`);
      shouldScrollRef.current = true;
    },
  });

  useEffect(() => {
    if (prevEncounterStatus) {
      prevEncounterStatusRef.current = prevEncounterStatus;
    }
  }, [prevEncounterStatus]);

  // Restore focus to input after a turn finishes processing or initial load completes
  useEffect(() => {
    if (!loading && connectionState === 'connected') {
      const timer = setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [loading, connectionState]);

  // Listen for audio-unlocked custom event to refocus input
  useEffect(() => {
    const handleAudioUnlocked = () => {
      if (!loading && connectionState === 'connected') {
        setTimeout(() => {
          inputRef.current?.focus();
        }, 50);
      }
    };
    document.addEventListener('audio-unlocked', handleAudioUnlocked);
    return () => document.removeEventListener('audio-unlocked', handleAudioUnlocked);
  }, [loading, connectionState]);

  // Load past history on initial session load
  useEffect(() => {
    if (!loading && session && !hasInitializedRef.current) {
      hasInitializedRef.current = true;

      const newEntries: TerminalEntry[] = [];
      newEntries.push({
        id: 'init-sys',
        type: 'system',
        text: `Adventure Shell Ready. Session: ${session.displayName}. Type 'help' for options.`,
      });

      history.forEach((turn, idx) => {
        const rollSeg = buildRollResultSegment(turn);
        if (rollSeg) {
          newEntries.push({
            id: `hist-roll-${idx}`,
            type: 'result',
            text: rollSeg,
          });
        }

        const narrSeg = buildNarrationSegment(turn);
        if (narrSeg) {
          newEntries.push({
            id: `hist-narr-${idx}`,
            type: 'narration',
            text: narrSeg,
          });
        }

        if (turn.imageUrl) {
          newEntries.push({
            id: `hist-img-${idx}`,
            type: 'system',
            text: '[Turn image ready - click to view]',
            imageUrl: turn.imageUrl,
          });
        }
      });

      const latestTurn = history[history.length - 1];
      if (latestTurn) {
        const activeCharSeg = buildActiveCharacterSegment(session);
        if (activeCharSeg) {
          newEntries.push({
            id: 'init-active-char',
            type: 'system',
            text: activeCharSeg,
          });
        }

        if (latestTurn.choices && latestTurn.choices.length > 0) {
          latestTurn.choices.forEach((choice, idx) => {
            newEntries.push({
              id: `init-choice-${idx}`,
              type: 'system',
              text: `${idx + 1}. ${choice.label}`,
            });
          });
        }
      }

      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLog(newEntries);
      shouldScrollRef.current = true;
    }
  }, [loading, session, history]);

  // Handle auto-scroll with anchoring
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) {
      return;
    }

    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= 40;
    if (isNearBottom || shouldScrollRef.current) {
      el.scrollTop = el.scrollHeight;
    }
    shouldScrollRef.current = false;
  }, [log]);

  const handleCarMode = useCallback(() => {
    if (id) {
      navigate(`/session/${id}/car`);
    }
  }, [id, navigate]);

  const handleClear = useCallback(() => {
    setLog([]);
  }, []);

  const executeCommand = useCallback(async (command: string) => {
    const trimmedCommand = command.trim();
    if (!trimmedCommand) {
      return;
    }

    addLogEntry('command', trimmedCommand);
    shouldScrollRef.current = true;

    if (trimmedCommand.toLowerCase() === 'clear') {
      setLog([]);
      return;
    }

    const intent = parseSpeechIntent(trimmedCommand);

    if (actionPreviewText) {
      if (intent.type === 'confirm') {
        if (actionPreview) {
          addLogEntry('system', 'Sending action to backend...');
          const preview = actionPreview;
          setActionPreviewText(null);
          clearPreview();

          try {
            await submitAction(
              preview.interpretedAction,
              preview.stat,
              preview.difficulty,
              preview.difficultyValue ?? null,
              null,
              null,
              null
            );
          } catch {
            addLogEntry('error', 'Action execution failed.');
          }
        } else {
          addLogEntry('system', 'Interpretation still in progress, please wait.');
        }
      } else if (intent.type === 'cancel') {
        addLogEntry('system', 'Action cancelled.');
        setActionPreviewText(null);
        clearPreview();

        const latestTurn = history[history.length - 1];
        if (latestTurn && latestTurn.choices) {
          latestTurn.choices.forEach((choice, idx) => {
            addLogEntry('system', `${idx + 1}. ${choice.label}`);
          });
        }
      } else if (intent.type === 'retry' || (intent.type === 'custom' && trimmedCommand.toLowerCase().startsWith('retry '))) {
        const newText = trimmedCommand.toLowerCase().startsWith('retry ')
          ? trimmedCommand.substring(6).trim()
          : intent.type === 'custom'
            ? intent.text
            : '';

        if (newText) {
          addLogEntry('system', `Retrying action: "${newText}"...`);
          setActionPreviewText(newText);
          clearPreview();
          await previewAction(newText);
        } else {
          addLogEntry('system', 'Action cancelled. Enter your next action.');
          setActionPreviewText(null);
          clearPreview();
        }
      } else {
        addLogEntry('system', "Waiting for confirmation. Type 'confirm', 'cancel', or 'retry [new action]'.");
      }
      return;
    }

    if (intent.type === 'choice') {
      const choices = history[history.length - 1]?.choices || [];
      const choice = choices[intent.index];
      if (choice) {
        addLogEntry('system', `Selected choice: ${choice.label}`);
        try {
          await submitAction(choice.label, choice.stat, choice.difficulty, choice.difficultyValue ?? null);
        } catch {
          addLogEntry('error', 'Failed to submit choice.');
        }
      } else {
        addLogEntry('system', `Choice ${intent.index + 1} is invalid. Type 'options' to see valid options.`);
      }
    } else if (intent.type === 'help') {
      addLogEntry('system', 'Available Commands:');
      addLogEntry('system', '  [1-4]             - Choose a numbered action option');
      addLogEntry('system', '  [custom action]   - Describe what your character does (runs preview)');
      addLogEntry('system', '  gear / inventory  - Inspect party and character inventory items');
      addLogEntry('system', '  status / info     - Show active character details and current scene state');
      addLogEntry('system', '  party / members   - View HP and state of all characters');
      addLogEntry('system', '  where are we      - Recaps location and situations');
      addLogEntry('system', '  options           - Re-list options for this turn');
      addLogEntry('system', '  repeat story      - Output latest DM description');
      addLogEntry('system', '  clear             - Clear this terminal screen');
    } else if (intent.type === 'status') {
      if (session) {
        addLogEntry('system', buildStatusSegment(session, 'action selection'));
      }
    } else if (intent.type === 'party') {
      if (session) {
        addLogEntry('system', buildPartySegment(session));
      }
    } else if (intent.type === 'gear') {
      if (session) {
        addLogEntry('system', buildGearSegment(session));
      }
    } else if (intent.type === 'where-are-we') {
      if (session) {
        const latestTurn = history[history.length - 1];
        addLogEntry('system', buildLocationSegment(session, latestTurn));
      }
    } else if (intent.type === 'repeat' || intent.type === 'options') {
      const latestTurn = history[history.length - 1];
      if (latestTurn && latestTurn.choices && latestTurn.choices.length > 0) {
        latestTurn.choices.forEach((choice, idx) => {
          addLogEntry('system', `${idx + 1}. ${choice.label}`);
        });
      } else {
        addLogEntry('system', 'No options available for the current turn.');
      }
    } else if (intent.type === 'story-repeat') {
      const latestTurn = history[history.length - 1];
      if (latestTurn?.narration) {
        addLogEntry('narration', latestTurn.narration);
      } else {
        addLogEntry('system', 'No story narration to repeat.');
      }
    } else if (intent.type === 'custom') {
      setActionPreviewText(intent.text);
      addLogEntry('system', `Interpreting custom action: "${intent.text}"...`);
      await previewAction(intent.text);
    } else {
      addLogEntry('system', 'Unknown command. Type "help" for a list of valid commands.');
    }
  }, [addLogEntry, actionPreviewText, actionPreview, clearPreview, submitAction, history, previewAction, session]);

  const handleHelp = useCallback(() => {
    void executeCommand('help');
  }, [executeCommand]);

  // Listen for global keyboard shortcuts (Ctrl+L, Escape, F1, F2, F3, F4)
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // Clear screen with Ctrl+L
      if (e.ctrlKey && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        handleClear();
        return;
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        if (activeImageUrl) {
          setActiveImageUrl(null);
        } else if (actionPreviewText) {
          addLogEntry('system', 'Action cancelled.');
          setActionPreviewText(null);
          clearPreview();
          const latestTurn = history[history.length - 1];
          if (latestTurn && latestTurn.choices) {
            latestTurn.choices.forEach((choice, idx) => {
              addLogEntry('system', `${idx + 1}. ${choice.label}`);
            });
          }
        } else if (inputValue) {
          setInputValue('');
        } else if (id) {
          navigate(`/session/${id}`);
        }
      } else if (e.key === 'F1') {
        e.preventDefault();
        handleHelp();
      } else if (e.key === 'F2') {
        e.preventDefault();
        handleCarMode();
      } else if (e.key === 'F3') {
        e.preventDefault();
        handleClear();
      } else if (e.key === 'F4') {
        e.preventDefault();
        toggleFullscreenMode();
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [id, navigate, inputValue, actionPreviewText, activeImageUrl, history, clearPreview, addLogEntry, toggleFullscreenMode, handleCarMode, handleHelp, handleClear]);

  // Sync fullscreen change events with local state and output log notices
  useEffect(() => {
    const handleFullscreenChange = () => {
      const isFull = !!document.fullscreenElement;
      setIsFullscreenMode(isFull);
      addLogEntry('system', isFull ? 'Fullscreen mode enabled. Press F4 or Esc to exit.' : 'Fullscreen mode disabled.');
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, [addLogEntry]);

  const handleFormSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!inputValue.trim()) {
      return;
    }
    const cmd = inputValue;
    setInputValue('');
    setCommandHistory(prev => [cmd, ...prev]);
    setHistoryIndex(-1);
    void executeCommand(cmd);
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (commandHistory.length > 0) {
        const nextIdx = historyIndex + 1;
        if (nextIdx < commandHistory.length) {
          setHistoryIndex(nextIdx);
          setInputValue(commandHistory[nextIdx]);
        }
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const nextIdx = historyIndex - 1;
      if (nextIdx >= 0) {
        setHistoryIndex(nextIdx);
        setInputValue(commandHistory[nextIdx]);
      } else {
        setHistoryIndex(-1);
        setInputValue('');
      }
    }
  };

  const getPrefix = (type: TerminalEntry['type']) => {
    switch (type) {
    case 'narration':
      return 'DM> ';
    case 'result':
      return 'ROLL> ';
    case 'command':
      return 'YOU> ';
    case 'error':
      return 'ERR> ';
    default:
      return 'SYS> ';
    }
  };

  const getColorClass = (type: TerminalEntry['type']) => {
    switch (type) {
    case 'narration':
      return 'text-emerald-400 font-narrative';
    case 'result':
      return 'text-yellow-400 font-mono';
    case 'command':
      return 'text-white font-mono font-bold';
    case 'error':
      return 'text-rose-500 font-mono';
    default:
      return 'text-slate-400 font-mono';
    }
  };

  const getAriaLabel = () => {
    if (connectionState === 'reconnecting') {
      return 'Terminal reconnecting';
    }
    if (loading) {
      return 'Terminal loading';
    }
    return 'D&D Terminal Log';
  };

  const handleExit = () => {
    if (id) {
      navigate(`/session/${id}`);
    }
  };

  const handleTerminalClick = () => {
    const selection = window.getSelection();
    if (!selection || selection.toString() === '') {
      inputRef.current?.focus();
    }
  };

  return (
    <div className="h-screen bg-slate-950 text-slate-100 flex flex-col overflow-hidden">
      <style>{`
        .crt-screen {
          position: relative;
          background-color: #030712;
          overflow: hidden;
          box-shadow: inset 0 0 80px rgba(0, 0, 0, 0.9);
        }
        .crt-screen::before {
          content: " ";
          display: block;
          position: absolute;
          top: 0; left: 0; bottom: 0; right: 0;
          background: linear-gradient(rgba(18, 16, 16, 0) 50%, rgba(0, 0, 0, 0.2) 50%), linear-gradient(90deg, rgba(255, 0, 0, 0.04), rgba(0, 255, 0, 0.01), rgba(0, 0, 255, 0.04));
          z-index: 10;
          background-size: 100% 3px, 3px 100%;
          pointer-events: none;
        }
        .crt-screen::after {
          content: " ";
          display: block;
          position: absolute;
          top: 0; left: 0; bottom: 0; right: 0;
          background: rgba(18, 16, 16, 0.1);
          opacity: 0;
          z-index: 10;
          pointer-events: none;
          animation: crt-flicker 0.15s infinite;
        }
        @keyframes crt-flicker {
          0% { opacity: 0.12; }
          50% { opacity: 0.08; }
          100% { opacity: 0.15; }
        }
        .terminal-glow {
          text-shadow: 0 0 3px currentColor;
        }
        .crt-input {
          caret-color: #34d399;
          caret-shape: block;
        }
        @media (prefers-reduced-motion: reduce) {
          .crt-screen::after {
            animation: none;
          }
        }
      `}</style>

      {/* Main Panel Viewport */}
      <div className="flex-1 flex flex-col p-4 md:p-6 overflow-hidden">
        {/* Terminal Case Shell */}
        <div
          onClick={handleTerminalClick}
          className="flex-1 crt-screen rounded-3xl border border-emerald-950 flex flex-col overflow-hidden bg-slate-950 p-4 md:p-6 relative"
        >
          
          {/* Header Status Bar */}
          <div className="border-b border-emerald-950/60 pb-3 mb-3 flex items-center justify-between text-xs text-emerald-600 font-mono tracking-wider">
            <div className="flex flex-wrap gap-x-4">
              <span>[SESSION: {session?.displayName?.toUpperCase() || 'LOADING...'}]</span>
              {session && (
                <>
                  <span>[TURN: {session.turn}]</span>
                  <span>
                    [MODE: {session.encounterState?.status === 'active'
                      ? `ENCOUNTER (${session.encounterState.name?.toUpperCase()})`
                      : 'EXPLORATION'}]
                  </span>
                </>
              )}
            </div>
            <div className="flex items-center space-x-2">
              <span className={`inline-block w-2.5 h-2.5 rounded-full ${
                connectionState === 'connected' ? 'bg-emerald-500 animate-pulse' :
                  connectionState === 'reconnecting' ? 'bg-amber-500 animate-pulse' : 'bg-rose-500'
              }`} />
              <span className="uppercase">
                {connectionState}
              </span>
            </div>
          </div>

          {/* Scrollback Log Pane */}
          <div
            ref={scrollRef}
            role="log"
            aria-label={getAriaLabel()}
            aria-live="polite"
            className="flex-1 overflow-y-auto space-y-2 pr-2 scrollbar-hide text-base md:text-lg pb-32"
          >
            {loading && log.length === 0 ? (
              <div className="text-emerald-500 font-mono terminal-glow animate-pulse">
                Initializing adventure secure link...
              </div>
            ) : (
              <>
                {log.map(entry => (
                  <div key={entry.id} className={`${getColorClass(entry.type)} leading-relaxed`}>
                    <span className="opacity-50 select-none">{getPrefix(entry.type)}</span>
                    <span className="terminal-glow select-text">
                      {entry.text}
                      {entry.imageUrl && (
                        <button
                          onClick={() => setActiveImageUrl(entry.imageUrl || null)}
                          className="ml-2 px-2 py-0.5 bg-emerald-950 border border-emerald-800 text-emerald-400 text-xs font-mono font-bold uppercase rounded cursor-pointer hover:bg-emerald-900 transition-colors"
                        >
                          View Image
                        </button>
                      )}
                    </span>
                  </div>
                ))}

                {previewThinking && (
                  <div className="text-amber-500 font-mono terminal-glow animate-pulse">
                    SYS&gt; DM is interpreting your custom action...
                  </div>
                )}

                {loading && (
                  <div className="text-emerald-500 font-mono terminal-glow animate-pulse">
                    SYS&gt; Processing next turn scene...
                  </div>
                )}
              </>
            )}
          </div>

          {/* Prompt Row */}
          <form onSubmit={handleFormSubmit} className="mt-4 border-t border-emerald-950/60 pt-4 flex items-center">
            <span className="text-emerald-500 font-mono font-bold mr-2 text-base md:text-lg select-none terminal-glow">
              &gt;
            </span>
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={e => setInputValue(e.target.value)}
              onKeyDown={handleInputKeyDown}
              disabled={loading || connectionState !== 'connected'}
              placeholder={actionPreviewText ? "Type confirm, cancel or retry..." : "Enter choice number or custom action..."}
              aria-label="Terminal command"
              className="flex-1 bg-transparent text-emerald-400 font-mono border-none outline-none focus:ring-0 text-base md:text-lg crt-input"
              autoFocus
            />
          </form>
        </div>

        {/* Function Keys / Retro Action Buttons */}
        <div className={`mt-4 flex flex-wrap gap-2 justify-center font-mono text-xs ${isFullscreenMode ? 'hidden' : ''}`}>
          <button
            onClick={handleExit}
            className="px-4 py-2 border border-slate-800 bg-slate-900/60 hover:bg-slate-800 rounded-lg text-slate-300 font-bold transition-all cursor-pointer"
          >
            [Esc] Back to Map
          </button>
          <button
            onClick={handleHelp}
            className="px-4 py-2 border border-emerald-900 bg-emerald-950/30 hover:bg-emerald-950/60 rounded-lg text-emerald-400 font-bold transition-all cursor-pointer"
          >
            [F1] Help Menu
          </button>
          <button
            onClick={handleCarMode}
            className="px-4 py-2 border border-slate-800 bg-slate-900/60 hover:bg-slate-800 rounded-lg text-slate-300 font-bold transition-all cursor-pointer"
          >
            [F2] Voice Mode
          </button>
          <button
            onClick={handleClear}
            className="px-4 py-2 border border-slate-800 bg-slate-900/60 hover:bg-slate-800 rounded-lg text-slate-300 font-bold transition-all cursor-pointer"
          >
            [F3] Clear Screen
          </button>
          <button
            onClick={toggleFullscreenMode}
            className="px-4 py-2 border border-slate-800 bg-slate-900/60 hover:bg-slate-800 rounded-lg text-slate-300 font-bold transition-all cursor-pointer"
          >
            [F4] Fullscreen
          </button>
        </div>
      </div>

      {/* Lightbox Modal */}
      {activeImageUrl && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
          onClick={() => setActiveImageUrl(null)}
        >
          <div
            className="relative max-w-4xl max-h-[85vh] bg-slate-900 border border-slate-800 rounded-3xl p-2 flex flex-col overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <img
              src={imgSrc(activeImageUrl)}
              alt="Adventure Scene"
              className="max-w-full max-h-[75vh] object-contain rounded-2xl"
            />
            <div className="mt-4 flex justify-between items-center px-4 pb-2">
              <span className="text-slate-400 font-mono text-xs">Adventure Scene Preview</span>
              <button
                onClick={() => setActiveImageUrl(null)}
                className="px-4 py-2 bg-rose-950 border border-rose-800 text-rose-300 text-sm font-mono font-bold rounded-xl cursor-pointer hover:bg-rose-900 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}


    </div>
  );
};
