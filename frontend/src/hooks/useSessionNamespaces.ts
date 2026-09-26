import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import type { SessionNamespacesResponse } from '../types';

// The signed-in user's realms, fetched once per page load and shared by the account
// menu and Home. A realm switch or joining a realm reloads the page, which refetches.
let cached: Promise<SessionNamespacesResponse | null> | null = null;

const load = (): Promise<SessionNamespacesResponse | null> => {
  cached ??= apiFetch('/auth/session/namespaces')
    .then(async res => (res.ok ? await res.json() as SessionNamespacesResponse : null))
    .catch(() => null);
  return cached;
};

export function resetSessionNamespacesCache(): void {
  cached = null;
}

export function useSessionNamespaces(enabled: boolean): SessionNamespacesResponse | null {
  const [data, setData] = useState<SessionNamespacesResponse | null>(null);
  useEffect(() => {
    if (!enabled) {
      return;
    }
    let cancelled = false;
    void load().then(result => {
      if (!cancelled) {
        setData(result);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return enabled ? data : null;
}
