/**
 * Admin: seed the Hedera SimpleUsdcVaultV2 with test USDC to scale demo NAV.
 *
 * Mints `amount` USDC from MockERC20Permit to the operator wallet, approves
 * the vault, and deposits. Uses HEDERA_OPERATOR_KEY (already in Vercel env).
 * CRON_SECRET-gated — not public.
 *
 * POST body: { amount?: number }   // human units, default 10000
 * Response : { txMint, txApprove, txDeposit, totalAssetsUsdc, hashScanUrl }
 */

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/utils/logger';
import { cronSecretMatches } from '@/lib/security/cron-auth';
import { HEDERA_CONTRACT_ADDRESSES } from '@/lib/contracts/addresses';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const USDC = HEDERA_CONTRACT_ADDRESSES.testnet.usdtToken;
const VAULT = HEDERA_CONTRACT_ADDRESSES.testnet.communityPool;
const DECIMALS = 6;
const RPC = 'https://testnet.hashio.io/api';

const ABI_USDC = [
  'function mint(address to, uint256 amount) external',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
];
const ABI_VAULT = [
  'function deposit(uint256 amount) external returns (uint256 shares)',
  'function totalAssets() view returns (uint256)',
];

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!cronSecretMatches(request.headers.get('authorization') || '', process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: { amount?: number } = {};
  try { body = (await request.json()) as { amount?: number }; } catch { /* default */ }
  const human = Math.max(1, Math.min(1_000_000, Number(body.amount ?? 10_000)));

  const key = (process.env.HEDERA_OPERATOR_KEY || '').trim();
  if (!key) return NextResponse.json({ error: 'HEDERA_OPERATOR_KEY missing' }, { status: 503 });

  try {
    const { ethers } = await import('ethers');
    const provider = new ethers.JsonRpcProvider(RPC);
    const wallet = new ethers.Wallet(key.startsWith('0x') ? key : '0x' + key, provider);

    const usdc = new ethers.Contract(USDC, ABI_USDC, wallet);
    const vault = new ethers.Contract(VAULT, ABI_VAULT, wallet);
    const amount = ethers.parseUnits(String(human), DECIMALS);

    const fee = {
      gasLimit: 800_000,
      maxFeePerGas: ethers.parseUnits('1500', 'gwei'),
      maxPriorityFeePerGas: ethers.parseUnits('1', 'gwei'),
      type: 2 as const,
    };

    const t1 = await usdc.mint(wallet.address, amount, fee);
    await t1.wait();
    const t2 = await usdc.approve(VAULT, amount, fee);
    await t2.wait();
    const t3 = await vault.deposit(amount, fee);
    await t3.wait();

    const totalAssets = await vault.totalAssets();
    logger.info('[admin/seed-hedera-vault] deposited', { human, txDeposit: t3.hash });

    return NextResponse.json({
      ok: true,
      amount: human,
      operator: wallet.address,
      txMint: t1.hash,
      txApprove: t2.hash,
      txDeposit: t3.hash,
      totalAssetsUsdc: Number(ethers.formatUnits(totalAssets, DECIMALS)),
      hashScanUrl: `https://hashscan.io/testnet/transaction/${t3.hash}`,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.warn('[admin/seed-hedera-vault] failed', { error: msg });
    return NextResponse.json({ error: msg.slice(0, 400) }, { status: 500 });
  }
}
