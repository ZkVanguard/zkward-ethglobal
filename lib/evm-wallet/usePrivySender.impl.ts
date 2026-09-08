'use client';

/**
 * Real implementation — imported only when Privy is enabled at build time.
 *
 * We DON'T use @privy-io/react-auth's useSendTransaction / useSignTypedData
 * hooks. When PrivyProvider is wrapped by @privy-io/wagmi, those hooks
 * hit "Cannot destructure property 'method' of 'o.signMessage'" because
 * the SDK expects a specific wallet-config path that isn't populated in
 * the wagmi bridge scenario.
 *
 * Instead: grab the embedded wallet's raw EIP-1193 provider directly via
 * useWallets() → wallet.getEthereumProvider(), then use viem's
 * walletClient to sign / send. This bypasses wagmi's connector arbitration
 * AND Privy's high-level hooks — guaranteed to sign with the embedded
 * wallet regardless of what wagmi's active connector thinks.
 */

import { useCallback, useMemo } from 'react';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { createWalletClient, custom, defineChain } from 'viem';
import type { PrivySender } from './usePrivySender';

// Inline Hedera testnet chain so this hook has zero cross-module deps
// (wagmi-config.ts imports would recurse via WalletProviders).
const hederaTestnetChain = defineChain({
  id: 296,
  name: 'Hedera Testnet',
  nativeCurrency: { name: 'HBAR', symbol: 'HBAR', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://testnet.hashio.io/api'] },
    public: { http: ['https://testnet.hashio.io/api'] },
  },
  blockExplorers: {
    default: { name: 'HashScan', url: 'https://hashscan.io/testnet' },
  },
});

export function usePrivySenderReal(): PrivySender | null {
  const { authenticated, ready } = usePrivy();
  const { wallets } = useWallets();

  const embedded = useMemo(
    () => wallets?.find((w) => w.walletClientType === 'privy'),
    [wallets],
  );

  const send: PrivySender['sendTransaction'] = useCallback(async (tx) => {
    if (!embedded) throw new Error('privy embedded wallet not available');
    // Force embedded wallet to the target chain before signing —
    // Hedera testnet in our case. Cheap idempotent op if already there.
    try { await embedded.switchChain(tx.chainId); } catch { /* already on chain */ }
    const provider = await embedded.getEthereumProvider();
    const walletClient = createWalletClient({
      account: embedded.address as `0x${string}`,
      chain: hederaTestnetChain,
      transport: custom(provider),
    });
    const hash = await walletClient.sendTransaction({
      to: tx.to,
      data: tx.data,
      value: tx.value ? BigInt(tx.value) : undefined,
    });
    return { hash };
  }, [embedded]);

  const sign: PrivySender['signTypedData'] = useCallback(async (payload) => {
    if (!embedded) throw new Error('privy embedded wallet not available');
    const provider = await embedded.getEthereumProvider();
    const walletClient = createWalletClient({
      account: embedded.address as `0x${string}`,
      chain: hederaTestnetChain,
      transport: custom(provider),
    });
    // viem accepts the standard EIP-712 shape { domain, types, primaryType, message }.
    const sig = await walletClient.signTypedData(payload as never);
    return sig;
  }, [embedded]);

  if (!ready || !authenticated || !embedded) return null;
  return { sendTransaction: send, signTypedData: sign };
}
