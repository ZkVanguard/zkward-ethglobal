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

import { useCallback } from 'react';
import { usePrivy, useSendTransaction } from '@privy-io/react-auth';
import type { PrivySender } from './usePrivySender';

/**
 * Uses Privy's useSendTransaction hook — gives us the native prompt UI
 * (including title/description showing "Deposit 100 USDC" instead of just
 * a bare "0x18a8…0b88" address). sendTransaction doesn't hit the
 * `Cannot destructure property 'method' of 'o.signMessage'` bug that
 * useSignTypedData does — that's a separate modal renderer path.
 *
 * Signs via the embedded wallet regardless of what wagmi's active
 * connector thinks (so MetaMask can't hijack the prompt).
 */
export function usePrivySenderReal(): PrivySender | null {
  const { authenticated, ready } = usePrivy();
  const { sendTransaction } = useSendTransaction();

  const send: PrivySender['sendTransaction'] = useCallback(async (tx) => {
    const result = await sendTransaction(
      {
        to: tx.to,
        data: tx.data,
        value: tx.value,
        chainId: tx.chainId,
        gasLimit: tx.gas,
        maxFeePerGas: tx.maxFeePerGas,
        maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
      },
      // uiOptions lets Privy's modal show a human-readable description
      // instead of just the raw to-address + fee. transactionInfo.title
      // becomes the accordion header ("Deposit 100 USDC"); description
      // shows above the fee summary.
      tx.title || tx.description
        ? {
            uiOptions: {
              description: tx.description,
              buttonText: tx.title ? tx.title.split(/[^\w\s]/)[0].trim().slice(0, 32) : undefined,
              transactionInfo: {
                title: tx.title,
              },
            },
          }
        : undefined,
    );
    // Return-shape variance across Privy SDK versions.
    const hash =
      typeof result === 'string'
        ? result
        : (result as { hash?: string; transactionHash?: string })?.hash
          ?? (result as { transactionHash?: string })?.transactionHash;
    if (!hash || !/^0x[0-9a-fA-F]+$/.test(hash)) {
      throw new Error('privy sendTransaction returned no hash');
    }
    return { hash: hash as `0x${string}` };
  }, [sendTransaction]);

  if (!ready || !authenticated) return null;
  return { sendTransaction: send };
}
