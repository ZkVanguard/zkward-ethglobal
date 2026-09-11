'use client';

/**
 * useLiveSignals — single source of truth for AI signal fusion.
 *
 * Wraps /api/predictions/per-asset in React Query so every panel that
 * consumes signals (projected hedges legs, pool stats projected metric,
 * insights panel) shares one deduped fetch keyed by the sorted asset
 * list. Guarantees the same numbers everywhere on the same page + one
 * network call instead of N.
 */

import { useQuery } from '@tanstack/react-query';

export interface AssetPrediction {
  direction: 'UP' | 'DOWN' | 'NEUTRAL';
  confidence: number;
  reasoning?: string;
  sourceCount?: number;
}

type SignalsMap = Record<string, AssetPrediction>;

const DEFAULT_ASSETS = ['BTC', 'ETH', 'SUI'] as const;

function signalKey(assets: readonly string[]) {
  return ['live-signals', [...assets].map((a) => a.toUpperCase()).sort().join(',')] as const;
}

export function useLiveSignals(assets: readonly string[] = DEFAULT_ASSETS) {
  return useQuery({
    queryKey: signalKey(assets),
    queryFn: async (): Promise<SignalsMap> => {
      const url = `/api/predictions/per-asset?assets=${assets.map((a) => a.toUpperCase()).join(',')}`;
      const r = await fetch(url);
      if (!r.ok) throw new Error(`predictions fetch failed: ${r.status}`);
      const j = (await r.json()) as { predictions?: SignalsMap };
      return j.predictions ?? {};
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}
