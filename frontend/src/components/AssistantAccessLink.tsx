import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import type { AccessTokenListResponse } from '../types';

// Settings entry to the Access tokens page. Shown to everyone while MCP is on (players
// without access can request it there), and to anyone who still has tokens to revoke.
export const AssistantAccessLink = () => {
  const [visible, setVisible] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    apiFetch('/access-tokens')
      .then(async res => {
        if (res.ok) {
          const body = await res.json() as AccessTokenListResponse;
          setVisible(body.mcpAvailable || body.tokens.length > 0);
        }
      })
      .catch(() => undefined);
  }, []);

  if (!visible) {
    return null;
  }
  return (
    <>
      <h2 className="text-lg font-black uppercase tracking-tighter text-amber-500 pt-2">AI assistants</h2>
      <button
        onClick={() => navigate('/access-tokens')}
        className="w-full py-3 bg-slate-800 hover:bg-slate-700 border-2 border-slate-700 rounded-[20px] font-black uppercase italic tracking-tighter transition-colors text-slate-300 text-sm"
      >
        Assistant access tokens
      </button>
    </>
  );
};
