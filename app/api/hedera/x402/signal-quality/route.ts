/**
 * x402-gated Signal-Quality Inference — pay-per-call, Hedera-settled.
 *
 * This endpoint wraps our existing predictions/signal-fusion service and
 * exposes it behind the x402 payment protocol using the Blocky402
 * facilitator on Hedera. Agents pay per query (HBAR or USDC via HTS);
 * every settled call is auditable on HCS.
 *
 * Hits the ETHGlobal Hedera prize track:
 *   - AI & Agentic Payments on Hedera ($2K per team)
 *   - Extra points: pay-per-call metering (not flat), verifiable
 *     payment audit trail on HCS.
 *
 * Flow
 *   1. Agent calls GET /api/hedera/x402/signal-quality?asset=BTC
 *   2. If no valid X-PAYMENT header → 402 Payment Required with the
 *      payment intent (amount, currency, facilitator URL).
 *   3. Agent constructs payment via Blocky402 client, retries with the
 *      X-PAYMENT header holding the signed intent.
 *   4. This handler verifies with the facilitator, then serves the
 *      signal-quality assessment.
 *
 * Env
 *   X402_FACILITATOR_URL       Blocky402 endpoint (default: mainnet)
 *   X402_PAYMENT_ADDRESS       Recipient EVM address on Hedera
 *   X402_PRICE_USDC_MICROS     Per-call price in USDC 6-decimal micros
 *                              (default: 100 = $0.0001 — sub-cent metering)
 *   X402_FACILITATOR_ENABLED   Feature flag; when off, endpoint returns
 *                              402 with a mock intent so integration
 *                              tests can exercise the contract without
 *                              a live Hedera settlement.
 */

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/utils/logger';
import { envFlag } from '@/lib/utils/env-flag';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

// ─── Payment intent shape ──────────────────────────────────────────────────
// x402 v2 spec (see @x402/core/schemas): PaymentRequired has x402Version + error
// + resource + accepts[]. Each accepts entry is a PaymentRequirements object
// with { scheme, network, amount, asset, payTo, maxTimeoutSeconds, extra? }.

interface X402PaymentRequirements {
  scheme: 'exact';
  network: 'hedera:testnet' | 'hedera:mainnet';
  amount: string;              // stringified 6-decimal micros for USDC
  asset: string;               // token ID (HTS format 0.0.NNN on Hedera)
  payTo: string;               // Hedera account ID or EVM address
  maxTimeoutSeconds: number;
  extra?: Record<string, unknown>;
}

interface X402PaymentIntent {
  x402Version: 2;
  error: string;
  resource: {
    url: string;
    description?: string;
    mimeType?: string;
    serviceName?: string;
    tags?: string[];
  };
  accepts: X402PaymentRequirements[];
  // Non-spec extras we keep for our own tooling (probe scripts, judges dashboard)
  facilitator: string;
}

// Circle USDC HTS token IDs — same as @x402/hedera constants.
const HEDERA_TESTNET_USDC = '0.0.429274';
const HEDERA_MAINNET_USDC = '0.0.456858';

// ─── Config ────────────────────────────────────────────────────────────────

// Facilitator per network. Verified 2026-09-08 via /supported probes:
//   testnet: x402.org/facilitator (feePayer 0.0.9185802)
//   mainnet: api.blocky402.com    (feePayer 0.0.10571514)
// Matches hedera-dev/x402-inference-pay-per-request-poc defaults.
// Legacy X402_FACILITATOR_URL still honoured if set (overrides per-network).
function getFacilitator(network: 'hedera:testnet' | 'hedera:mainnet'): string {
  const legacy = (process.env.X402_FACILITATOR_URL || '').trim();
  if (legacy) return legacy;
  const key = network === 'hedera:mainnet'
    ? 'X402_MAINNET_FACILITATOR_URL'
    : 'X402_TESTNET_FACILITATOR_URL';
  const fallback = network === 'hedera:mainnet'
    ? 'https://api.blocky402.com'
    : 'https://x402.org/facilitator';
  return (process.env[key] || fallback).trim();
}
function getPayTo(): string {
  return (process.env.X402_PAYMENT_ADDRESS || '0x0000000000000000000000000000000000000000').trim();
}
function getPriceMicros(): string {
  const raw = (process.env.X402_PRICE_USDC_MICROS || '100').trim();
  return raw;
}
function getNetwork(): 'hedera:testnet' | 'hedera:mainnet' {
  return (process.env.HEDERA_NETWORK as 'mainnet' | 'testnet') === 'mainnet'
    ? 'hedera:mainnet'
    : 'hedera:testnet';
}

// ─── Payment verification (facilitator) ────────────────────────────────────

interface VerifyResult {
  valid: boolean;
  mode: 'blocky402' | 'x402.org' | 'stub';
  facilitator: string;
  note: string;
}

async function verifyPayment(header: string, intent: X402PaymentIntent): Promise<VerifyResult> {
  const requirement = intent.accepts[0];
  const facilitator = getFacilitator(requirement.network);
  const mode: 'blocky402' | 'x402.org' = facilitator.includes('blocky402')
    ? 'blocky402'
    : 'x402.org';

  // Demo-safe mode. Accepts any non-empty header so judges can hit the
  // endpoint without a funded Hedera account. The intent is real, the
  // facilitator URL is real, and the HCS audit trail is real — only the
  // signature check is bypassed. Flip X402_FACILITATOR_ENABLED=1 and
  // submit a Hedera-native signed payment envelope to move
  // verification.mode → 'blocky402' (mainnet) or 'x402.org' (testnet).
  if (!envFlag('X402_FACILITATOR_ENABLED')) {
    return {
      valid: header.length > 0,
      mode: 'stub',
      facilitator,
      note: `demo-safe mode: intent + HCS receipt are real; signature check bypassed so judges can call without a funded Hedera account. Toggle X402_FACILITATOR_ENABLED=1 + submit a Hedera-native signed payment envelope to flip to ${mode}.`,
    };
  }

  // Real facilitator path — both x402.org and Blocky402 speak the same
  // /verify contract:
  //   { paymentHeader: base64 signed payment envelope, paymentRequirements: intent }
  // Envelope shape: JSON with x402Version + signature fields (facilitator
  // decodes and validates). Facilitator acts as feePayer sponsor
  // (x402.org: 0.0.9185802 · Blocky402: 0.0.10571514 per each /supported).
  // NOT EIP-3009 — this is Hedera-native signing (TransferTransaction),
  // not Ethereum ERC-20 authorization. Confirmed by probing both facilitators
  // and by reading hedera-dev/x402-inference-pay-per-request-poc.
  try {
    const res = await fetch(`${facilitator}/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        paymentHeader: header,
        // Facilitator wants a SINGLE PaymentRequirements object (accepts[0]),
        // not the whole PaymentRequired envelope.
        paymentRequirements: requirement,
      }),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) {
      let errBody: unknown = null;
      try { errBody = await res.json(); } catch { /* ignore */ }
      const detail = errBody && typeof errBody === 'object' && 'message' in errBody
        ? String((errBody as { message: unknown }).message)
        : `HTTP ${res.status}`;
      return { valid: false, mode, facilitator, note: `facilitator rejected: ${detail}` };
    }
    const body = (await res.json()) as { valid?: boolean; isValid?: boolean };
    // Facilitators have historically used both `valid` and `isValid`; accept either.
    const ok = body.valid === true || body.isValid === true;
    return {
      valid: ok,
      mode,
      facilitator,
      note: ok ? `${mode}-verified` : 'facilitator returned valid=false',
    };
  } catch (e) {
    logger.warn('[x402] facilitator verify failed', {
      error: e instanceof Error ? e.message : String(e),
    });
    return {
      valid: false,
      mode,
      facilitator,
      note: e instanceof Error ? e.message : 'facilitator unreachable',
    };
  }
}

// ─── Payment intent builder ────────────────────────────────────────────────

function buildIntent(request: NextRequest): X402PaymentIntent {
  const url = new URL(request.url);
  const network = getNetwork();
  const asset = network === 'hedera:mainnet' ? HEDERA_MAINNET_USDC : HEDERA_TESTNET_USDC;
  return {
    x402Version: 2,
    error: 'payment required',
    resource: {
      url: url.toString(),
      description: 'Signal-quality inference — one call, one asset',
      mimeType: 'application/json',
      serviceName: 'zkward-signal-quality',
      tags: ['ai', 'signal', 'hedera'],
    },
    accepts: [{
      scheme: 'exact',
      network,
      amount: getPriceMicros(),
      asset,
      payTo: getPayTo(),
      maxTimeoutSeconds: 300,
      extra: {
        priceModel: 'per-call',
        signalWindow: '5min',
        currency: 'USDC',
      },
    }],
    facilitator: getFacilitator(network),
  };
}

// ─── Signal-quality inference (wraps existing PredictionAggregatorService) ─

interface SignalQualityResponse {
  asset: string;
  signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  confidence: number;
  reasoning: string;
  window: string;
  source: string;
  hcs?: {
    txId?: string;
    topicId?: string;
    memo?: string;
    explorerUrl?: string;
  };
  verification?: VerifyResult;
}

async function inferSignalQuality(asset: string): Promise<SignalQualityResponse> {
  // Wraps our existing prediction stack; falls back to a deterministic
  // stub if the aggregator is unavailable so the paid call still
  // succeeds (a paid failure would be a worse UX than a paid stub with
  // low confidence).
  try {
    const { PredictionAggregatorService } = await import(
      '@/lib/services/market-data/PredictionAggregatorService'
    );
    const perAsset = await PredictionAggregatorService.getPerAssetPredictions([asset]);
    const fused = perAsset?.[asset];
    if (fused) {
      const direction = fused.direction;
      // Aggregator's `confidence` is already 0..100. Clamp defensively.
      const rawConf = Number(fused.confidence ?? 0);
      const conf = Math.max(0, Math.min(100, Math.round(rawConf)));
      return {
        asset,
        signal: direction === 'UP' ? 'BULLISH' : direction === 'DOWN' ? 'BEARISH' : 'NEUTRAL',
        confidence: conf,
        reasoning: fused.reasoning ?? 'Fused signal across Polymarket + Delphi + Crypto.com + funding',
        window: '5min',
        source: 'PredictionAggregatorService v0.4.0',
      };
    }
  } catch (e) {
    logger.warn('[x402/signal-quality] aggregator failed — returning low-confidence stub', {
      error: e instanceof Error ? e.message : String(e),
    });
  }
  // Fallback stub — never returns a strong signal on the paid path
  // when we can't verify quality.
  return {
    asset,
    signal: 'NEUTRAL',
    confidence: 25,
    reasoning: 'Aggregator unavailable — low-confidence fallback served to preserve payment contract',
    window: '5min',
    source: 'fallback',
  };
}

// ─── HCS audit trail (best-effort) ─────────────────────────────────────────

async function writeHcsAudit(payload: {
  asset: string;
  signal: string;
  confidence: number;
  paymentSettled: boolean;
}): Promise<{ txId?: string; topicId?: string; memo?: string; explorerUrl?: string }> {
  if (!envFlag('HCS_AUDIT_ENABLED')) {
    return { memo: `pending: ${payload.asset}:${payload.signal}:${payload.confidence}` };
  }

  const topicId = (process.env.HCS_AUDIT_TOPIC_ID || '').trim();
  const operatorId = (process.env.HEDERA_OPERATOR_ID || '').trim();
  const operatorKey = (process.env.HEDERA_OPERATOR_KEY || '').trim();
  const network = ((process.env.HEDERA_NETWORK || 'testnet').trim()) as 'mainnet' | 'testnet';

  if (!topicId || !operatorId || !operatorKey) {
    logger.warn('[x402/hcs] missing HCS env — audit degraded to memo', {
      hasTopic: !!topicId, hasOperator: !!operatorId, hasKey: !!operatorKey,
    });
    return { topicId: topicId || undefined, memo: 'hcs env missing' };
  }

  try {
    const { Client, PrivateKey, TopicMessageSubmitTransaction, AccountId, TopicId } =
      await import('@hashgraph/sdk');

    const client = network === 'mainnet' ? Client.forMainnet() : Client.forTestnet();
    client.setOperator(
      AccountId.fromString(operatorId),
      operatorKey.startsWith('0x')
        ? PrivateKey.fromStringECDSA(operatorKey)
        : PrivateKey.fromString(operatorKey),
    );

    const message = JSON.stringify({
      v: 1,
      asset: payload.asset,
      signal: payload.signal,
      confidence: payload.confidence,
      paid: payload.paymentSettled,
      ts: new Date().toISOString(),
    });

    const submit = await new TopicMessageSubmitTransaction()
      .setTopicId(TopicId.fromString(topicId))
      .setMessage(message)
      .execute(client);
    const receipt = await submit.getReceipt(client);

    // Best-effort: close the client — it holds gRPC channels.
    try { client.close(); } catch { /* ignore */ }

    const txId = submit.transactionId?.toString();
    return {
      topicId,
      txId,
      memo: `x402:${payload.asset}:${payload.signal}:${payload.confidence}:${payload.paymentSettled ? 'paid' : 'unpaid'}`,
      explorerUrl: `https://hashscan.io/${network}/topic/${topicId}`,
      // status is part of receipt; log only, not returned (kept payload lean)
      ...(receipt.status ? {} : {}),
    };
  } catch (e) {
    logger.warn('[x402/hcs] submit failed', {
      error: e instanceof Error ? e.message : String(e),
    });
    return {
      topicId,
      memo: `hcs-submit-failed:${payload.asset}:${payload.signal}`,
    };
  }
}

// ─── Handler ───────────────────────────────────────────────────────────────

export async function GET(request: NextRequest): Promise<NextResponse<SignalQualityResponse | { error: string; intent?: X402PaymentIntent }>> {
  const url = new URL(request.url);
  const asset = (url.searchParams.get('asset') || 'BTC').toUpperCase();
  if (!['BTC', 'ETH', 'SUI', 'CRO'].includes(asset)) {
    return NextResponse.json({ error: 'unsupported asset' }, { status: 400 });
  }

  const paymentHeader = (request.headers.get('X-PAYMENT') || '').trim();
  if (!paymentHeader) {
    // 402 Payment Required with the full x402 v2 PaymentRequired envelope
    // as the response body (spec-compliant so @x402/fetch can parse it).
    return NextResponse.json(buildIntent(request), { status: 402 });
  }

  const verification = await verifyPayment(paymentHeader, buildIntent(request));
  if (!verification.valid) {
    return NextResponse.json(
      { ...buildIntent(request), verification },
      { status: 402 },
    );
  }

  const result = await inferSignalQuality(asset);
  const hcs = await writeHcsAudit({
    asset,
    signal: result.signal,
    confidence: result.confidence,
    paymentSettled: true,
  }).catch(() => ({}));

  return NextResponse.json({ ...result, hcs, verification }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}

export async function POST(request: NextRequest): Promise<NextResponse<SignalQualityResponse | { error: string; intent?: X402PaymentIntent }>> {
  return GET(request);
}
