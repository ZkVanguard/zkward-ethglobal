'use client';

/**
 * Real implementation — only imported when Privy is enabled at build time.
 * Split from the safe wrapper so tests + non-Privy builds don't need to
 * satisfy the '@privy-io/react-auth' peer.
 *
 * Address resolution order:
 *   1. Locally-stored wallet from createWallet() promise resolution —
 *      immediate on Google-first login before useWallets() or user.linked
 *      Accounts refresh. Highest priority so the dashboard renders the
 *      wallet card the instant Privy returns it.
 *   2. useWallets() — fastest once Privy's WagmiProvider has connected
 *      the embedded wallet, but may be empty for a beat after Google
 *      login while the wallet materialises server-side.
 *   3. user.linkedAccounts — the source of truth. Every account tied
 *      to the current Privy user, including embedded EVM wallets.
 *   4. useCreateWallet().createWallet() — fired once when the user is
 *      authenticated but no embedded wallet is linked. Handles the
 *      edge case where createOnLogin didn't trigger (some Google-first
 *      flows skip it silently).
 */

import { useEffect, useRef, useState } from 'react';
import { usePrivy, useWallets, useCreateWallet } from '@privy-io/react-auth';

interface LinkedAccountLike {
  type?: string;
  address?: string;
  walletClientType?: string;
  wallet_client_type?: string;
  chainType?: string;
  chain_type?: string;
}

interface CreatedWalletLike {
  address?: string;
}

function findEmbeddedFromLinkedAccounts(
  linkedAccounts: readonly LinkedAccountLike[] | undefined,
): string | null {
  if (!linkedAccounts) return null;
  // Prefer explicit ethereum embedded wallets. Privy also stores solana +
  // bitcoin embedded wallets under the same 'wallet' type — filter by chain.
  const embedded = linkedAccounts.find(
    (a) =>
      a.type === 'wallet' &&
      (a.walletClientType === 'privy' || a.wallet_client_type === 'privy') &&
      (a.chainType === 'ethereum' || a.chain_type === 'ethereum' || !a.chainType),
  );
  return embedded?.address ?? null;
}

export function usePrivyEmbeddedAddressReal(): `0x${string}` | null {
  return usePrivyEmbeddedStatusReal().address;
}

/**
 * Full status — use this when the UI needs to distinguish "signed out"
 * from "signed in, wallet is being created" (which currently render the
 * same in HederaVaultActions and confuse Google-first users).
 */
export function usePrivyEmbeddedStatusReal(): {
  address: `0x${string}` | null;
  isCreating: boolean;
  authenticated: boolean;
  ready: boolean;
} {
  const { authenticated, user, ready } = usePrivy();
  const { wallets } = useWallets();
  const { createWallet } = useCreateWallet();

  // Store the just-created wallet locally — useWallets() takes several
  // seconds to refresh after Privy provisions the embedded wallet server
  // side; without this the dashboard sits on "Sign in..." for the whole
  // window between Google-auth completion and wallet materialisation.
  const [createdAddress, setCreatedAddress] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  // Auto-create embedded wallet exactly once per authenticated session
  // when no embedded EVM wallet is linked. Privy's createOnLogin: 'users-
  // without-wallets' should handle this automatically, but some Google
  // login flows silently skip it — this belt-and-braces catches those.
  const autoCreatedRef = useRef(false);
  useEffect(() => {
    if (!ready || !authenticated) {
      // Signed out → reset so a subsequent sign-in can re-run auto-create.
      autoCreatedRef.current = false;
      setCreatedAddress(null);
      setIsCreating(false);
      return;
    }
    if (autoCreatedRef.current) return;
    const walletFromHook = wallets?.find((w) => w.walletClientType === 'privy');
    const walletFromLinked = findEmbeddedFromLinkedAccounts(
      user?.linkedAccounts as unknown as LinkedAccountLike[],
    );
    if (walletFromHook || walletFromLinked) {
      autoCreatedRef.current = true;
      return;
    }
    autoCreatedRef.current = true;
    setIsCreating(true);
    createWallet()
      .then((w: unknown) => {
        const addr = (w as CreatedWalletLike | undefined)?.address ?? null;
        if (addr && /^0x[a-fA-F0-9]{40}$/.test(addr)) {
          setCreatedAddress(addr);
        }
      })
      .catch((e) => {
        // Reset so the next dependency change can retry — Privy sometimes
        // rejects the first call on Google-flow race conditions.
        autoCreatedRef.current = false;
        // eslint-disable-next-line no-console
        console.warn('[privy] auto-create embedded wallet failed', e);
      })
      .finally(() => {
        setIsCreating(false);
      });
  }, [ready, authenticated, wallets, user, createWallet]);

  if (!authenticated) {
    return { address: null, isCreating: false, authenticated: false, ready };
  }

  // 0. Just-created wallet from local state — immediate on Google login.
  if (createdAddress && /^0x[a-fA-F0-9]{40}$/.test(createdAddress)) {
    return { address: createdAddress as `0x${string}`, isCreating: false, authenticated, ready };
  }

  // 1. useWallets — preferred (has walletClientType for disambiguation).
  const fromWallets = wallets?.find((w) => w.walletClientType === 'privy') ?? wallets?.[0];
  if (fromWallets?.address) {
    return { address: fromWallets.address as `0x${string}`, isCreating: false, authenticated, ready };
  }

  // 2. Fallback to linked accounts on the user object.
  const fromLinked = findEmbeddedFromLinkedAccounts(
    user?.linkedAccounts as unknown as LinkedAccountLike[],
  );
  if (fromLinked && /^0x[a-fA-F0-9]{40}$/.test(fromLinked)) {
    return { address: fromLinked as `0x${string}`, isCreating: false, authenticated, ready };
  }

  return { address: null, isCreating, authenticated, ready };
}
