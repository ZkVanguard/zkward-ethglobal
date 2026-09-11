'use client';

/**
 * useTokenBalances — reactive HBAR + USDC + vault-share balances for
 * an address on Hedera Testnet.
 *
 * Wraps wagmi's useBalance (native HBAR) + useReadContract (USDC token,
 * vault sharesOf) into one hook. Every component that needs to display
 * or reason about a wallet's on-chain position reads from here.
 *
 * Deduplication: wagmi + viem internally cache reads by { address,
 * chainId, contract, args } — so multiple components calling this hook
 * with the same address share the underlying RPC round-trip. Balances
 * auto-refetch every 15s while the tab is focused.
 *
 * Returns null values while loading / when address is missing.
 */

import { useBalance, useReadContract } from 'wagmi';
import { erc20Abi } from 'viem';
import { HEDERA_CONTRACT_ADDRESSES } from '@/lib/contracts/addresses';

const USDC_DECIMALS = 6;
const HBAR_DECIMALS = 18; // native EVM representation on Hashio
const SHARE_DECIMALS = 6; // SimpleUsdcVaultV2 shares are 6-dec micros

const usdcAddress = HEDERA_CONTRACT_ADDRESSES.testnet.usdtToken as `0x${string}`;
const vaultAddress = HEDERA_CONTRACT_ADDRESSES.testnet.communityPool as `0x${string}`;

const vaultAbi = [
  { name: 'sharesOf', inputs: [{ name: '', type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
] as const;

export interface TokenBalances {
  ready: boolean;
  // Raw amounts (bigint) — pass into contract calls directly.
  hbar: bigint | null;
  usdc: bigint | null;
  shares: bigint | null;
  // Human-formatted amounts — safe to display.
  hbarHuman: number;
  usdcHuman: number;
  sharesHuman: number;
  // Manual refresh — invalidates all three reads.
  refetch: () => void;
}

export function useTokenBalances(address: string | null | undefined): TokenBalances {
  const enabled = !!address && /^0x[a-fA-F0-9]{40}$/.test(address);

  const { data: hbarData, refetch: refetchHbar } = useBalance({
    address: enabled ? (address as `0x${string}`) : undefined,
    query: { enabled, refetchInterval: 15_000, staleTime: 5_000 },
  });

  const { data: usdcData, refetch: refetchUsdc } = useReadContract({
    address: usdcAddress,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: enabled ? [address as `0x${string}`] : undefined,
    query: { enabled, refetchInterval: 15_000, staleTime: 5_000 },
  });

  const { data: sharesData, refetch: refetchShares } = useReadContract({
    address: vaultAddress,
    abi: vaultAbi,
    functionName: 'sharesOf',
    args: enabled ? [address as `0x${string}`] : undefined,
    query: { enabled, refetchInterval: 15_000, staleTime: 5_000 },
  });

  const hbar = (hbarData?.value ?? null) as bigint | null;
  const usdc = (usdcData ?? null) as bigint | null;
  const shares = (sharesData ?? null) as bigint | null;

  return {
    ready: enabled,
    hbar,
    usdc,
    shares,
    hbarHuman: hbar != null ? Number(hbar) / 10 ** HBAR_DECIMALS : 0,
    usdcHuman: usdc != null ? Number(usdc) / 10 ** USDC_DECIMALS : 0,
    sharesHuman: shares != null ? Number(shares) / 10 ** SHARE_DECIMALS : 0,
    refetch: () => {
      void refetchHbar();
      void refetchUsdc();
      void refetchShares();
    },
  };
}
