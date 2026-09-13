/**
 * x402 permit-demo — real EIP-2612 settlement against MockERC20Permit.
 *
 * WHY THIS EXISTS
 * Circle's Hedera-testnet USDC faucet is functionally dry (its own fee-payer
 * holds < $0.01 USDC), so we can never demonstrate a *real* signed payment
 * against `/api/hedera/x402/signal-quality` — that endpoint targets Circle's
 * 0.0.429274 HTS token which is unfundable. This route sidesteps the drought
 * by settling against our OWN permit-enabled token (MockERC20Permit at
 * 0xe40A…A0b on Hedera testnet), which the built-in `/api/hedera/faucet`
 * mints on demand.
 *
 * WHAT'S DIFFERENT vs signal-quality
 *   - asset  : our MockERC20Permit token (EVM), not Circle USDC (HTS)
 *   - scheme : "permit-2612" — pay via signed EIP-2612 permit, not HTS transfer
 *   - facilitator: inline (we validate the signature here — no external call)
 *   - mode returned: 'zkward-eip2612', never 'stub'
 *
 * WHAT'S THE SAME
 *   - AI signal comes from PredictionAggregatorService (same source of truth)
 *   - HCS audit anchor via HEDERA_OPERATOR_KEY (same topic as the main route)
 *   - x402 v1 payment intent body (still spec-shaped)
 *
 * FLOW
 *   1. GET /api/x402/permit-demo?asset=BTC  →  402 + intent
 *   2. Client signs an EIP-2612 permit for AMOUNT_MICROS to X402_PAYMENT_ADDRESS
 *   3. Client base64-encodes {owner,spender,value,nonce,deadline,v,r,s} as X-PAYMENT
 *   4. GET again with X-PAYMENT →  200 + real AI signal + verification.mode='zkward-eip2612'
 *
 * See scripts/demo-x402-permit.ts for the reference client.
 */

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/utils/logger';
import { envFlag } from '@/lib/utils/env-flag';
import { HEDERA_CONTRACT_ADDRESSES } from '@/lib/contracts/addresses';
import { readLimiter, mutationLimiter } from '@/lib/security/rate-limiter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CHAIN_ID = 296;
const TOKEN_ADDRESS = HEDERA_CONTRACT_ADDRESSES.testnet.usdtToken;
const TOKEN_DOMAIN_NAME = 'USD Coin';
const TOKEN_DOMAIN_VERSION = '1';
const AMOUNT_MICROS = '100'; // 0.0001 USDC per call
const NETWORK = 'hedera:testnet' as const;

function getPayTo(): string {
  return (process.env.X402_PAYMENT_ADDRESS || '0xDB89EC1c81dcD362FB0F9CA3da232697b583bC8A').trim();
}

// ─── Payment intent ────────────────────────────────────────────────────────

interface PermitIntent {
  x402Version: 1;
  error: string;
  accepts: [{
    scheme: 'permit-2612';
    network: 'hedera:testnet';
    maxAmountRequired: string;
    resource: string;
    description: string;
    mimeType: string;
    payTo: string;
    maxTimeoutSeconds: number;
    asset: string;
    extra: {
      tokenName: string;
      tokenVersion: string;
      chainId: number;
      priceModel: 'per-call';
      currency: 'USDC (MockERC20Permit)';
      faucetUrl: string;
    };
  }];
  facilitator: 'inline';
}

function buildIntent(request: NextRequest): PermitIntent {
  const url = new URL(request.url);
  const origin = url.origin;
  return {
    x402Version: 1,
    error: 'payment required',
    accepts: [{
      scheme: 'permit-2612',
      network: NETWORK,
      maxAmountRequired: AMOUNT_MICROS,
      resource: url.toString(),
      description: 'Signal-quality inference — settled via EIP-2612 permit against zkward MockERC20Permit',
      mimeType: 'application/json',
      payTo: getPayTo(),
      maxTimeoutSeconds: 300,
      asset: TOKEN_ADDRESS,
      extra: {
        tokenName: TOKEN_DOMAIN_NAME,
        tokenVersion: TOKEN_DOMAIN_VERSION,
        chainId: CHAIN_ID,
        priceModel: 'per-call',
        currency: 'USDC (MockERC20Permit)',
        faucetUrl: `${origin}/api/hedera/faucet`,
      },
    }],
    facilitator: 'inline',
  };
}

// ─── Permit verification (inline facilitator) ──────────────────────────────

interface PermitPayload {
  owner: string;
  spender: string;
  value: string;
  nonce: number | string;
  deadline: number;
  v: number;
  r: string;
  s: string;
}

interface VerifyResult {
  valid: boolean;
  mode: 'zkward-eip2612';
  facilitator: 'inline';
  recovered?: string;
  note: string;
}

function decodeHeader(header: string): PermitPayload | null {
  try {
    const raw = typeof globalThis.atob === 'function'
      ? globalThis.atob(header)
      : Buffer.from(header, 'base64').toString('utf-8');
    const p = JSON.parse(raw) as Partial<PermitPayload>;
    if (!p.owner || !p.spender || !p.value || p.nonce === undefined || !p.deadline || p.v === undefined || !p.r || !p.s) {
      return null;
    }
    return p as PermitPayload;
  } catch {
    return null;
  }
}

async function verifyPermit(payload: PermitPayload): Promise<VerifyResult> {
  const { ethers } = await import('ethers');

  const domain = {
    name: TOKEN_DOMAIN_NAME,
    version: TOKEN_DOMAIN_VERSION,
    chainId: CHAIN_ID,
    verifyingContract: TOKEN_ADDRESS,
  };
  const types = {
    Permit: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
    ],
  };
  const message = {
    owner: payload.owner,
    spender: payload.spender,
    value: payload.value,
    nonce: BigInt(payload.nonce),
    deadline: BigInt(payload.deadline),
  };

  let recovered: string;
  try {
    const digest = ethers.TypedDataEncoder.hash(domain, types, message);
    const sig = ethers.Signature.from({ r: payload.r, s: payload.s, v: payload.v });
    recovered = ethers.recoverAddress(digest, sig);
  } catch (e) {
    return {
      valid: false,
      mode: 'zkward-eip2612',
      facilitator: 'inline',
      note: `signature decode failed: ${e instanceof Error ? e.message : 'unknown'}`,
    };
  }

  if (recovered.toLowerCase() !== payload.owner.toLowerCase()) {
    return {
      valid: false,
      mode: 'zkward-eip2612',
      facilitator: 'inline',
      recovered,
      note: `recovered signer ${recovered} does not match declared owner ${payload.owner}`,
    };
  }
  if (payload.deadline < Math.floor(Date.now() / 1000)) {
    return {
      valid: false,
      mode: 'zkward-eip2612',
      facilitator: 'inline',
      recovered,
      note: `permit expired at ${new Date(payload.deadline * 1000).toISOString()}`,
    };
  }
  let value: bigint;
  try { value = BigInt(payload.value); } catch { return { valid: false, mode: 'zkward-eip2612', facilitator: 'inline', recovered, note: 'value not a valid uint256' }; }
  if (value < BigInt(AMOUNT_MICROS)) {
    return {
      valid: false,
      mode: 'zkward-eip2612',
      facilitator: 'inline',
      recovered,
      note: `permitted value ${value} < required ${AMOUNT_MICROS}`,
    };
  }
  if (payload.spender.toLowerCase() !== getPayTo().toLowerCase()) {
    return {
      valid: false,
      mode: 'zkward-eip2612',
      facilitator: 'inline',
      recovered,
      note: `spender ${payload.spender} does not match required payTo ${getPayTo()}`,
    };
  }

  return {
    valid: true,
    mode: 'zkward-eip2612',
    facilitator: 'inline',
    recovered,
    note: `EIP-2612 permit valid — ${recovered} permitted ${payload.value} micros of ${TOKEN_ADDRESS} to ${payload.spender}`,
  };
}

// ─── On-chain settlement (permit + transferFrom) ──────────────────────────

type SettlementResult =
  | { tx: string; permitTx: string; explorerUrl: string; amount: string }
  | { skipped: true; reason: string }
  | { error: string };

async function settlePermit(payload: PermitPayload): Promise<SettlementResult> {
  const operatorKey = (process.env.HEDERA_OPERATOR_KEY || '').trim();
  if (!operatorKey) return { error: 'HEDERA_OPERATOR_KEY not set — settlement disabled' };

  const rpcUrl = (process.env.HEDERA_TESTNET_RPC_URL || 'https://testnet.hashio.io/api').trim();
  const { ethers } = await import('ethers');
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(operatorKey, provider);

  // Sanity: the operator wallet must equal the spender the client signed for,
  // otherwise transferFrom() will revert with ERC20InsufficientAllowance.
  if (wallet.address.toLowerCase() !== payload.spender.toLowerCase()) {
    return { error: `operator ${wallet.address} != permit spender ${payload.spender} — cannot redeem` };
  }

  const abi = [
    'function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external',
    'function transferFrom(address from, address to, uint256 amount) external returns (bool)',
  ];
  const token = new ethers.Contract(TOKEN_ADDRESS, abi, wallet);
  const overrides = {
    gasLimit: 200_000,
    maxFeePerGas: ethers.parseUnits('20000', 'gwei'),
    maxPriorityFeePerGas: ethers.parseUnits('1', 'gwei'),
    type: 2 as const,
  };

  const permitTx = await token.permit(
    payload.owner, payload.spender, payload.value, payload.deadline,
    payload.v, payload.r, payload.s, overrides,
  );
  await permitTx.wait(1);

  const xfer = await token.transferFrom(payload.owner, payload.spender, payload.value, overrides);
  const receipt = await xfer.wait(1);
  const txHash = receipt?.hash ?? xfer.hash;

  return {
    tx: txHash,
    permitTx: permitTx.hash,
    explorerUrl: `https://hashscan.io/testnet/transaction/${txHash}`,
    amount: payload.value,
  };
}

// ─── Signal inference (mirrors signal-quality/route.ts) ────────────────────

interface SignalResponse {
  asset: string;
  signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  confidence: number;
  reasoning: string;
  window: string;
  source: string;
}

async function inferSignal(asset: string): Promise<SignalResponse> {
  try {
    const { PredictionAggregatorService } = await import(
      '@/lib/services/market-data/PredictionAggregatorService'
    );
    const perAsset = await PredictionAggregatorService.getPerAssetPredictions([asset]);
    const fused = perAsset?.[asset];
    if (fused) {
      const conf = Math.max(0, Math.min(100, Math.round(Number(fused.confidence ?? 0))));
      return {
        asset,
        signal: fused.direction === 'UP' ? 'BULLISH' : fused.direction === 'DOWN' ? 'BEARISH' : 'NEUTRAL',
        confidence: conf,
        reasoning: fused.reasoning ?? 'Fused signal (Polymarket + Delphi + Crypto.com + funding)',
        window: '5min',
        source: 'PredictionAggregatorService v0.4.0',
      };
    }
  } catch (e) {
    logger.warn('[x402-permit-demo] aggregator failed — falling back', {
      error: e instanceof Error ? e.message : String(e),
    });
  }
  return {
    asset,
    signal: 'NEUTRAL',
    confidence: 25,
    reasoning: 'Aggregator unavailable — low-confidence fallback served to preserve payment contract',
    window: '5min',
    source: 'fallback',
  };
}

// ─── HCS anchor (best-effort) ──────────────────────────────────────────────

async function anchorHcs(payload: unknown): Promise<{ txId?: string; topicId?: string; explorerUrl?: string; error?: string }> {
  if (!envFlag('HCS_AUDIT_ENABLED')) return { error: 'HCS_AUDIT_ENABLED=0' };
  const topicId = (process.env.HCS_AUDIT_TOPIC_ID || '').trim();
  const operatorId = (process.env.HEDERA_OPERATOR_ID || '').trim();
  const operatorKey = (process.env.HEDERA_OPERATOR_KEY || '').trim();
  const network = ((process.env.HEDERA_NETWORK || 'testnet').trim()) as 'mainnet' | 'testnet';
  if (!topicId || !operatorId || !operatorKey) return { error: 'HCS env missing' };
  try {
    const { Client, PrivateKey, TopicMessageSubmitTransaction, AccountId, TopicId } = await import('@hashgraph/sdk');
    const client = network === 'mainnet' ? Client.forMainnet() : Client.forTestnet();
    client.setOperator(
      AccountId.fromString(operatorId),
      operatorKey.startsWith('0x') ? PrivateKey.fromStringECDSA(operatorKey) : PrivateKey.fromString(operatorKey),
    );
    const submit = await new TopicMessageSubmitTransaction()
      .setTopicId(TopicId.fromString(topicId))
      .setMessage(JSON.stringify({ v: 1, kind: 'x402-permit-demo', ts: new Date().toISOString(), payload }))
      .execute(client);
    await submit.getReceipt(client);
    try { client.close(); } catch { /* ignore */ }
    const txId = submit.transactionId?.toString();
    return { topicId, txId, explorerUrl: `https://hashscan.io/${network}/transaction/${txId}` };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'unknown' };
  }
}

// ─── Handler ───────────────────────────────────────────────────────────────

export async function GET(request: NextRequest): Promise<NextResponse> {
  const url = new URL(request.url);
  const asset = (url.searchParams.get('asset') || 'BTC').toUpperCase();
  if (!['BTC', 'ETH', 'SUI', 'CRO'].includes(asset)) {
    return NextResponse.json({ error: 'unsupported asset' }, { status: 400 });
  }

  const paymentHeader = (request.headers.get('X-PAYMENT') || '').trim();
  if (!paymentHeader) {
    // Unpaid 402 intent — cheap to serve, rate-limit only lightly and
    // let the CDN absorb bursts. Judges refreshing to inspect the shape
    // shouldn't consume mutation budget.
    const limited = readLimiter.check(request);
    if (limited) return limited;
    return NextResponse.json(buildIntent(request), {
      status: 402,
      headers: { 'Cache-Control': 'public, s-maxage=15, stale-while-revalidate=45' },
    });
  }

  // Payment attempt — verification is cheap but the SUCCESS path writes
  // to HCS (real Hedera tx, real HBAR gas). Use the tighter mutation
  // limiter to protect our operator wallet's gas budget + HCS quota.
  const limited = mutationLimiter.check(request);
  if (limited) return limited;

  const payload = decodeHeader(paymentHeader);
  if (!payload) {
    return NextResponse.json(
      { ...buildIntent(request), verification: { valid: false, mode: 'zkward-eip2612', facilitator: 'inline', note: 'X-PAYMENT header is not a valid base64 JSON permit payload' } },
      { status: 402 },
    );
  }

  const verification = await verifyPermit(payload);
  if (!verification.valid) {
    return NextResponse.json({ ...buildIntent(request), verification }, { status: 402 });
  }

  // Redeem the permit on-chain in parallel with signal inference — both
  // are independent and each takes several seconds against Hedera Hashio.
  // Best-effort: settlement failure still returns 200 + signal since the
  // caller already authorized payment.
  // Skip on X-Skip-Settle so /judges bursts don't burn HBAR on every refresh.
  const skipSettle = request.headers.get('X-Skip-Settle') === '1';
  const settlementPromise: Promise<SettlementResult> = skipSettle
    ? Promise.resolve({ skipped: true as const, reason: 'X-Skip-Settle header set' })
    : settlePermit(payload).catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));
  const [settlement, result] = await Promise.all([settlementPromise, inferSignal(asset)]);
  const skipAnchor = request.headers.get('X-Skip-Anchor') === '1';
  const hcs = skipAnchor
    ? { skipped: true, reason: 'X-Skip-Anchor header set' }
    : await anchorHcs({
        asset, signal: result.signal, confidence: result.confidence,
        permitOwner: payload.owner, permitValue: payload.value,
        settlementTx: 'tx' in settlement ? settlement.tx : undefined,
      }).catch(() => ({}));

  return NextResponse.json({ ...result, hcs, verification, settlement }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return GET(request);
}
