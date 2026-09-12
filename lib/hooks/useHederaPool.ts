'use client';

/**
 * useHederaPool — single source of truth for the Hedera community pool
 * summary (TVL, share price, member count, allocation).
 *
 * Consolidates three previously-independent fetches into one deduped
 * React Query:
 *   - SuiPoolLanding.fetchPoolSummary (homepage hero, 60s refetch)
 *   - SuiPoolLanding.HederaVaultCallout (bottom-of-homepage stats card)
 *   - useCommunityPool (dashboard Pool tab pool state)
 *
 * All three now hit /api/community-pool?chain=hedera&network=testnet
 * through the same query key. Same-page mounts share one fetch.
 *
 * Cached 30s stale-time, 60s refetch. Matches the server-side
 * cachedJsonResponse ceiling so revalidation always hits a warm CDN.
 */

import { useQuery } from '@tanstack/react-query';

export type HederaNetwork = 'testnet' | 'mainnet';

export interface HederaPoolResponse {
  success?: boolean;
  pool?: {
    totalValueUSD?: number;
    sharePrice?: number;
    memberCount?: number;
    totalShares?: number;
    totalDeposited?: number;
    totalWithdrawn?: number;
    allocation?: Record<string, number>;
    paused?: boolean;
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

function poolKey(network: HederaNetwork) {
  return ['hedera-pool', network] as const;
}

export function useHederaPool(network: HederaNetwork = 'testnet') {
  return useQuery({
    queryKey: poolKey(network),
    queryFn: async (): Promise<HederaPoolResponse> => {
      const r = await fetch(`/api/community-pool?chain=hedera&network=${network}`, {
        cache: 'no-store',
      });
      if (!r.ok) throw new Error(`hedera-pool ${r.status}`);
      return (await r.json()) as HederaPoolResponse;
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}
