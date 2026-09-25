/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { apiFetch } from '../lib/api';
import type { AuthConfigResponse, AuthMeResponse } from '../types';

interface AuthUser {
  email: string;
  namespaceId: string;
}

interface AuthState {
  enabled: boolean;
  user: AuthUser | null;
  loading: boolean;
  // The auth config could not be loaded. Never treated as "auth disabled".
  unavailable: boolean;
  config: AuthConfigResponse | null;
}

interface AuthContextValue extends AuthState {
  logout: () => Promise<void>;
  refetch: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const UNAVAILABLE: AuthState = { enabled: true, user: null, loading: false, unavailable: true, config: null };

async function loadAuthState(): Promise<AuthState> {
  try {
    const configRes = await apiFetch('/auth/config');
    if (!configRes.ok) {
      return UNAVAILABLE;
    }
    const config = await configRes.json() as AuthConfigResponse;

    if (!config.enabled) {
      return { enabled: false, user: null, loading: false, unavailable: false, config };
    }

    const meRes = await apiFetch('/auth/me');
    if (meRes.ok) {
      const me = await meRes.json() as AuthMeResponse;
      if (me.email) {
        return { enabled: true, user: { email: me.email, namespaceId: me.namespaceId }, loading: false, unavailable: false, config };
      }
    } else if (meRes.status !== 401) {
      return UNAVAILABLE;
    }
    return { enabled: true, user: null, loading: false, unavailable: false, config };
  } catch {
    return UNAVAILABLE;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ enabled: false, user: null, loading: true, unavailable: false, config: null });

  const refetch = (): Promise<void> => {
    setState(s => ({ ...s, loading: true }));
    return loadAuthState().then(setState).catch(() => {
      setState(UNAVAILABLE);
    });
  };

  useEffect(() => {
    loadAuthState().then(setState).catch(() => {
      setState(UNAVAILABLE);
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
