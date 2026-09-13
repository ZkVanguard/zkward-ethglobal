'use client';

/**
 * usePrivySender — safe wrapper around Privy's useSendTransaction hook.
 * Returns null when Privy is disabled or the user isn't Privy-authenticated
 * with an embedded wallet, so callers can cleanly branch to wagmi's
 * writeContractAsync in that case.
 *
 * Why this exists: HederaVaultActions (and future EVM deposit UIs) call
 * `useWriteContract()` from wagmi. When a user has BOTH MetaMask injected
 * AND is logged into Privy, wagmi's active connector = MetaMask, so
 * writeContractAsync signs via MetaMask — even when we passed the Privy
 * embedded address as the "from" address for reads. This wrapper gives us
 * a direct Privy signing path so we can force embedded-wallet TXs when
 * that's the wallet the UI is showing.
 *
 * Follows the same split pattern as usePrivyEmbeddedAddress: the real
 * hook lives in .impl.ts and is only imported when Privy is enabled at
 * build time (so non-Privy builds don't need @privy-io/react-auth
 * resolved).
 */

import { isPrivyEnabled } from './privy-config';
import { usePrivySenderReal } from './usePrivySender.impl';

export interface PrivySender {
  sendTransaction: (tx: {
    to: `0x${string}`;
    data?: `0x${string}`;
    value?: `0x${string}`;
    chainId: number;
    /** Human-readable label rendered in the wallet prompt UI ("Deposit 100 USDC…"). */
    title?: string;
    /** Longer description shown alongside the tx details. */
    description?: string;
    /** Hedera Hashio rejects unset fees with 400 → "Missing or invalid parameters". */
    gas?: bigint;
    maxFeePerGas?: bigint;
    maxPriorityFeePerGas?: bigint;
  }) => Promise<{ hash: `0x${string}` }>;
}

export function usePrivySender(): PrivySender | null {
  // Static: same branch every render for this build (Next inlines the env).
  if (!isPrivyEnabled()) return null;
  return usePrivySenderReal();
}
