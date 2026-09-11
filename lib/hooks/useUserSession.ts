'use client';

/**
 * useUserSession — the single top-level hook for anything wallet-adjacent.
 *
 * Composes:
 *   - Privy auth state (ready, authenticated, isCreating)
 *   - Primary EVM address (Privy embedded > wagmi injected fallback)
 *   - Chain state (current chainId, needsChainSwitch to Hedera Testnet)
 *   - Identity (display name via /api/profile, auth method + email + joinedAt from Privy user)
 *   - Balances (HBAR, USDC, vault shares — reactive, 15s refetch)
 *   - Actions (refreshBalances, logout)
 *
 * Every dashboard surface that reasons about "the current user" should
 * read from THIS hook — one call, one object, everything coherent.
 * Individual pieces (useWalletProfile, useTokenBalances, etc.) remain
 * available for surfaces that only need a slice.
 *
 * Dashboard-only. Do not import from marketing routes — the Privy hooks
 * used here require PrivyProvider in the tree.
 */

import { useMemo } from 'react';
import { useChainId } from 'wagmi';
import { usePrivy, useLogout } from '@privy-io/react-auth';
import { usePrivyEmbeddedAddress, usePrivyEmbeddedStatus } from '@/lib/evm-wallet/usePrivyEmbeddedAddress';
import { useWalletProfile } from './useWalletProfile';
import { useTokenBalances, type TokenBalances } from './useTokenBalances';

const HEDERA_TESTNET_ID = 296;

export type AuthMethod = 'email' | 'google' | 'wallet' | null;

export interface UserSession {
  // Auth state
  ready: boolean;
  authenticated: boolean;
  isCreating: boolean;

  // Primary EVM address (Hedera Testnet)
  address: `0x${string}` | null;

  // Chain state
  chainId: number | null;
  needsChainSwitch: boolean; // true when connected but on wrong chain

  // Identity — populated only when authenticated
  displayName: string | null;
  authMethod: AuthMethod;
  emailAddress: string | null;
  joinedAt: Date | null;

  // Balances
  balances: TokenBalances;

  // Actions
  refreshBalances: () => void;
  logout: () => Promise<void>;
}

interface PrivyUserLike {
  email?: { address?: string } | null;
  google?: { email?: string } | null;
  createdAt?: number | string;
}

export function useUserSession(): UserSession {
  const address = usePrivyEmbeddedAddress();
  const privyStatus = usePrivyEmbeddedStatus();
  const chainId = useChainId();
  const { data: profile } = useWalletProfile(address);
  const balances = useTokenBalances(address);
  const { user } = usePrivy() as { user: PrivyUserLike | null };
  const { logout } = useLogout();

  return useMemo<UserSession>(() => {
    const emailAddress = user?.email?.address ?? user?.google?.email ?? null;
    const authMethod: AuthMethod =
      user?.google?.email ? 'google' :
      user?.email?.address ? 'email' :
      user ? 'wallet' :
      null;
    const joined = user?.createdAt ? new Date(user.createdAt) : null;
    return {
      ready: privyStatus.ready,
      authenticated: privyStatus.authenticated,
      isCreating: privyStatus.isCreating,
      address,
      chainId: chainId ?? null,
      needsChainSwitch: !!address && !!chainId && chainId !== HEDERA_TESTNET_ID,
      displayName: profile?.displayName ?? null,
      authMethod,
      emailAddress,
      joinedAt: joined && !isNaN(joined.getTime()) ? joined : null,
      balances,
      refreshBalances: balances.refetch,
      logout,
    };
  }, [
    privyStatus.ready,
    privyStatus.authenticated,
    privyStatus.isCreating,
    address,
    chainId,
    profile?.displayName,
    user,
    balances,
    logout,
  ]);
}
