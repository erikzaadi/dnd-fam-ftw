/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { apiFetch } from '../lib/api';

interface AuthUser {
  email: string;
  namespaceId: string;
}

interface AuthState {
  enabled: boolean;
  user: AuthUser | null;
  loading: boolean;
}

interface AuthContextValue extends AuthState {
  logout: () => Promise<void>;
  refetch: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function loadAuthState(): Promise<AuthState> {
  try {
    const configRes = await apiFetch('/auth/config');
    const config = await configRes.json() as { enabled: boolean };

    if (!config.enabled) {
      return { enabled: false, user: null, loading: false };
    }

    const meRes = await apiFetch('/auth/me');
    if (meRes.ok) {
      const me = await meRes.json() as { email: string; namespaceId: string };
      return { enabled: true, user: { email: me.email, namespaceId: me.namespaceId }, loading: false };
    }
    return { enabled: true, user: null, loading: false };
  } catch {
    return { enabled: false, user: null, loading: false };
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ enabled: false, user: null, loading: true });

  const refetch = () => {
    loadAuthState().then(setState).catch(() => {
      setState({ enabled: false, user: null, loading: false });
    });
  };

  useEffect(() => {
    loadAuthState().then(setState).catch(() => {
      setState({ enabled: false, user: null, loading: false });
    });
  }, []);

  const logout = async () => {
    await apiFetch('/auth/logout', { method: 'POST' });
    setState(s => ({ ...s, user: null }));
  };

  return (
    <AuthContext.Provider value={{ ...state, logout, refetch }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return ctx;
}
