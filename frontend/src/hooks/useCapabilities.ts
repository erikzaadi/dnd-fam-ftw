import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';

export interface Capabilities {
  hasLocalAI: boolean;
  hasCloudAI: boolean;
  hasTts: boolean;
}

const DEFAULT_CAPABILITIES: Capabilities = {
  hasLocalAI: false,
  hasCloudAI: false,
  hasTts: false,
};

export function useCapabilities() {
  const [capabilities, setCapabilities] = useState<Capabilities>(DEFAULT_CAPABILITIES);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    apiFetch('/capabilities')
      .then(r => r.ok ? r.json() : DEFAULT_CAPABILITIES)
      .then((data: Partial<Capabilities>) => {
        if (cancelled) {
          return;
        }
        setCapabilities({
          hasLocalAI: !!data.hasLocalAI,
          hasCloudAI: !!data.hasCloudAI,
          hasTts: !!data.hasTts,
        });
      })
      .catch(() => {
        if (!cancelled) {
          setCapabilities(DEFAULT_CAPABILITIES);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return { capabilities, loading };
}
