import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import type { Capabilities } from '../types';

export type { Capabilities };

const DEFAULT_CAPABILITIES: Capabilities = {
  hasCloudAI: false,
  hasTts: false,
  ttsLegacyModel: false,
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
          hasCloudAI: !!data.hasCloudAI,
          hasTts: !!data.hasTts,
          ttsLegacyModel: !!data.ttsLegacyModel,
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
