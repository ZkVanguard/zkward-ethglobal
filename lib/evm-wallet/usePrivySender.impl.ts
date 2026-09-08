'use client';

/**
 * Real implementation — only imported when Privy is enabled at build time.
 * Wraps @privy-io/react-auth's useSendTransaction into the PrivySender
 * shape the safe wrapper exposes.
 *
 * useSendTransaction always signs with the current Privy user's embedded
 * wallet, regardless of what wagmi's active connector thinks. That's the
 * whole point — bypass wagmi's connector arbitration when we know we
 * want the embedded wallet to sign.
 */

import { useCallback } from 'react';
import { usePrivy, useSendTransaction, useSignTypedData } from '@privy-io/react-auth';
import type { PrivySender } from './usePrivySender';

export function usePrivySenderReal(): PrivySender | null {
  const { authenticated, ready } = usePrivy();
  const { sendTransaction } = useSendTransaction();
  const { signTypedData } = useSignTypedData();

  const send: PrivySender['sendTransaction'] = useCallback(async (tx) => {
    const result = await sendTransaction({
      to: tx.to,
      data: tx.data,
      value: tx.value,
      chainId: tx.chainId,
    });
    // Privy's return shape varies by SDK version: sometimes a hex string,
    // sometimes { hash }, sometimes { transactionHash }. Normalise to hash.
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

  const sign: PrivySender['signTypedData'] = useCallback(async (payload) => {
    // Same return-shape variance as sendTransaction — normalise.
    const result = await signTypedData(payload as never);
    const sig =
      typeof result === 'string'
        ? result
        : (result as { signature?: string })?.signature;
    if (!sig || !/^0x[0-9a-fA-F]+$/.test(sig)) {
      throw new Error('privy signTypedData returned no signature');
    }
    return sig as `0x${string}`;
  }, [signTypedData]);

  if (!ready || !authenticated) return null;
  return { sendTransaction: send, signTypedData: sign };
}
