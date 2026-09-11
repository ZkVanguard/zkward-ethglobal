'use client';

/**
 * useLivePrices — single source of truth for spot prices.
 *
 * Wraps /api/prices in React Query so every panel that displays a
 * mark price or computes P&L shares one deduped fetch. Same story
 * as useLiveSignals: query key derived from the sorted symbol list.
 */

import { useQuery } from '@tanstack/react-query';

export interface PriceRow {
  symbol: string;
  price: number;
  change24h?: number;
}

type PriceMap = Record<string, PriceRow>;

const DEFAULT_SYMBOLS = ['BTC', 'ETH', 'SUI'] as const;

function priceKey(symbols: readonly string[]) {
  return ['live-prices', [...symbols].map((s) => s.toUpperCase()).sort().join(',')] as const;
}

export function useLivePrices(symbols: readonly string[] = DEFAULT_SYMBOLS) {
  return useQuery({
    queryKey: priceKey(symbols),
    queryFn: async (): Promise<PriceMap> => {
      const url = `/api/prices?symbols=${symbols.map((s) => s.toUpperCase()).join(',')}`;
      const r = await fetch(url);
      if (!r.ok) throw new Error(`prices fetch failed: ${r.status}`);
      const j = (await r.json()) as { data?: PriceRow[] };
      const out: PriceMap = {};
      for (const row of j.data ?? []) out[row.symbol.toUpperCase()] = row;
      return out;
    },
    staleTime: 10_000,
    refetchInterval: 15_000,
  });
}
