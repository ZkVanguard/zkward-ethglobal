'use client';

/**
 * Projected pool hedges for the Hedera vault.
 *
 * Not user-opened positions (that's HederaPerpsPanel) — these are the
 * perp positions the AI would open on behalf of the pool based on its
 * current NAV + the platform's hedging heuristic. Real prices, real
 * signal-fused directional bias, real HCS attestation of the entry
 * snapshot so the "entry price" isn't cherry-picked post-hoc.
 *
 * Data lineage
 *   - Prices: /api/prices (multi-source aggregator, 5s poll)
 *   - Side: /api/predictions/per-asset (Polymarket + Delphi + Crypto.com
 *     + funding fusion). UP → LONG, DOWN → SHORT, NEUTRAL → LONG
 *     (defensive default; also flagged in the row).
 *   - Attestation: /api/hedera/attest-hedges posts one HCS message per
 *     basket. Judges + users click the tx to verify entry snapshot on
 *     HashScan. Shows Hedera consensus finality (typically 2-4s).
 *
 * When a real Hedera-native perp DEX exists, swap the projections for
 * real on-chain reads. Until then this is the honest "what would happen
 * at scale" surface, anchored to Hedera consensus.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { TrendingUp, TrendingDown, Activity, Info, ExternalLink, Anchor } from 'lucide-react';

const ACCENT = '#00A79F';
const PRICE_POLL_MS = 5000;

type Symbol = 'BTC' | 'ETH' | 'SUI';
type Side = 'LONG' | 'SHORT' | 'HOLD';

// Below this confidence, treat signal as no-conviction → HOLD (no position).
// Real AI shouldn't put on a directional bet with a weak signal. Matches
// the SIGNAL_FLIP_MIN_CONF default in CLAUDE.md's defense stack.
const MIN_CONVICTION_PCT = 55;

interface PriceRow { price: number; change24h?: number }
interface PriceMap { [k: string]: PriceRow }
interface SignalRow { side: Side; confidence: number; direction: 'UP' | 'DOWN' | 'NEUTRAL' }
interface SignalMap { [k: string]: SignalRow }

interface ProjectedPosition {
  symbol: Symbol;
  side: Side;
  entryPrice: number;
  sizeToken: number;
  notionalUsd: number;
  marginUsd: number;
  leverage: number;
  signalConfidence: number;
  signalDirection: 'UP' | 'DOWN' | 'NEUTRAL';
}

interface Attestation {
  txId?: string;
  topicId?: string;
  consensusTimestamp?: string;
  finalityMs?: number;
  explorerUrl?: string;
  reason?: string;
  attested: boolean;
}

interface Props {
  /** Current pool NAV in USDC. Used to size projections proportionally. */
  poolNavUsd: number;
}

const ASSET_ALLOCATION = 0.30; // 30% of NAV per asset
const LEVERAGE = 2;

async function fetchPrices(): Promise<PriceMap> {
  try {
    const r = await fetch('/api/prices?symbols=BTC,ETH,SUI', { cache: 'no-store' });
    if (!r.ok) return {};
    const j = (await r.json()) as { data?: Array<{ symbol: string; price: number; change24h?: number }> };
    const out: PriceMap = {};
    for (const row of j.data ?? []) {
      out[row.symbol] = { price: row.price, change24h: row.change24h };
    }
    return out;
  } catch {
    return {};
  }
}

async function fetchSignals(): Promise<SignalMap> {
  try {
    const r = await fetch('/api/predictions/per-asset?assets=BTC,ETH,SUI', { cache: 'no-store' });
    if (!r.ok) return {};
    const j = (await r.json()) as {
      predictions?: Record<string, { direction?: 'UP' | 'DOWN' | 'NEUTRAL'; confidence?: number }>;
    };
    const out: SignalMap = {};
    for (const [sym, p] of Object.entries(j.predictions ?? {})) {
      const direction = p.direction ?? 'NEUTRAL';
      const confidence = Math.round(p.confidence ?? 0);
      // NEUTRAL or below-threshold → HOLD. No-conviction bets are the
      // opposite of what an AI-managed vault should do; would rather sit
      // in USDC than open a directional leg on weak signals.
      let side: Side;
      if (direction === 'NEUTRAL' || confidence < MIN_CONVICTION_PCT) side = 'HOLD';
      else side = direction === 'DOWN' ? 'SHORT' : 'LONG';
      out[sym] = { side, confidence, direction };
    }
    return out;
  } catch {
    return {};
  }
}

async function attestBasket(payload: {
  poolNavUsd: number;
  positions: ProjectedPosition[];
}): Promise<Attestation> {
  try {
    const r = await fetch('/api/hedera/attest-hedges', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        poolNavUsd: payload.poolNavUsd,
        positions: payload.positions.map((p) => ({
          symbol: p.symbol,
          side: p.side,
          entryPrice: p.entryPrice,
          notionalUsd: p.notionalUsd,
          marginUsd: p.marginUsd,
          leverage: p.leverage,
          signalConfidence: p.signalConfidence,
        })),
      }),
    });
    return (await r.json()) as Attestation;
  } catch (e) {
    return { attested: false, reason: e instanceof Error ? e.message : 'attest failed' };
  }
}

function fmtUsd(n: number, digits = 2): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function fmtPct(n: number, digits = 2): string {
  return `${n >= 0 ? '+' : ''}${(n * 100).toFixed(digits)}%`;
}

export function HederaPoolHedgesProjection({ poolNavUsd }: Props) {
  const [prices, setPrices] = useState<PriceMap>({});
  const [signals, setSignals] = useState<SignalMap>({});
  const [loaded, setLoaded] = useState(false);
  const [attestation, setAttestation] = useState<Attestation | null>(null);

  const entriesRef = useRef<Record<Symbol, number> | null>(null);
  const attestRef = useRef<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      const [p, s] = await Promise.all([fetchPrices(), fetchSignals()]);
      if (cancelled) return;
      if (Object.keys(p).length > 0) {
        setPrices(p);
        if (!entriesRef.current && p.BTC?.price && p.ETH?.price && p.SUI?.price) {
          entriesRef.current = { BTC: p.BTC.price, ETH: p.ETH.price, SUI: p.SUI.price };
          setLoaded(true);
        }
      }
      if (Object.keys(s).length > 0) setSignals(s);
    };
    tick();
    const iv = window.setInterval(() => {
      if (!document.hidden) tick();
    }, PRICE_POLL_MS);
    return () => { cancelled = true; window.clearInterval(iv); };
  }, []);

  const positions: ProjectedPosition[] = useMemo(() => {
    if (!entriesRef.current) return [];
    const notionalIfActive = poolNavUsd * ASSET_ALLOCATION;
    return (['BTC', 'ETH', 'SUI'] as Symbol[]).map((symbol) => {
      // Entry = mark ÷ (1 + 24h change) — derives a "if we'd opened this
      // yesterday" reference price from live 24h delta. Makes P&L a
      // meaningful retrospective on real price movement.
      const mark = prices[symbol]?.price;
      const change24h = prices[symbol]?.change24h;
      const entryPrice = mark && typeof change24h === 'number' && (1 + change24h) > 0
        ? mark / (1 + change24h)
        : entriesRef.current![symbol];
      const sig = signals[symbol];
      // Missing signal defaults to HOLD (was LONG — that was a bad
      // default; a no-signal state is not conviction to buy).
      const side: Side = sig?.side ?? 'HOLD';
      // HOLD → capital sits in USDC, contributes zero notional / margin / P&L.
      const notional = side === 'HOLD' ? 0 : notionalIfActive;
      const marginPerLeg = notional / LEVERAGE;
      return {
        symbol,
        side,
        entryPrice,
        sizeToken: notional > 0 ? notional / entryPrice : 0,
        notionalUsd: notional,
        marginUsd: marginPerLeg,
        leverage: LEVERAGE,
        signalConfidence: sig?.confidence ?? 0,
        signalDirection: sig?.direction ?? 'NEUTRAL',
      };
    });
  }, [poolNavUsd, loaded, signals, prices]);

  useEffect(() => {
    if (attestRef.current) return;
    if (positions.length === 0 || !loaded) return;
    if (poolNavUsd <= 0) return;
    // Wait for at least one real signal to avoid attesting an all-defaults basket.
    const anyRealSignal = positions.some((p) => p.signalConfidence > 0);
    if (!anyRealSignal) return;

    attestRef.current = true;
    (async () => {
      const result = await attestBasket({ poolNavUsd, positions });
      setAttestation(result);
    })();
  }, [positions, loaded, poolNavUsd]);

  const totals = useMemo(() => {
    let notional = 0;
    let margin = 0;
    let upnl = 0;
    let holdUsd = 0;
    for (const p of positions) {
      if (p.side === 'HOLD') {
        holdUsd += poolNavUsd * ASSET_ALLOCATION;
        continue;
      }
      const mark = prices[p.symbol]?.price ?? p.entryPrice;
      notional += p.notionalUsd;
      margin += p.marginUsd;
      const dirMul = p.side === 'LONG' ? 1 : -1;
      upnl += (mark - p.entryPrice) * p.sizeToken * dirMul;
    }
    return { notional, margin, upnl, holdUsd };
  }, [positions, prices, poolNavUsd]);

  if (poolNavUsd <= 0) {
    return null;
  }

  return (
    <div className="p-3 sm:p-4 border-b border-gray-100 dark:border-gray-700">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <Activity className="w-4 h-4" style={{ color: ACCENT }} />
        <h3 className="text-sm sm:text-[15px] font-semibold text-label-primary">
          Projected pool hedges
        </h3>
        <span
          className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wide"
          style={{ background: `${ACCENT}15`, color: ACCENT }}
        >
          Signal-fused · Hedera
        </span>
      </div>

      <div className="text-[11px] text-label-tertiary mb-3 leading-relaxed">
        What the pool AI would open with the current ${fmtUsd(poolNavUsd)} NAV.
        {' '}{Math.round(ASSET_ALLOCATION * 100)}% per asset, {LEVERAGE}× leverage,
        {' '}sides derived from live prediction fusion. Signals below
        {' '}{MIN_CONVICTION_PCT}% conviction hold in USDC — the AI won&apos;t bet
        {' '}without a view. P&amp;L = 24h price move at {LEVERAGE}×.
      </div>

      {positions.length === 0 ? (
        <div className="text-[11px] text-label-tertiary py-4 text-center">
          Waiting for live prices &amp; signals…
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2 mb-3">
            <StatCell label="Notional" value={`$${fmtUsd(totals.notional)}`} />
            <StatCell label="Margin" value={`$${fmtUsd(totals.margin)}`} />
            <StatCell
              label="24h P&L @ 2×"
              value={`${totals.upnl >= 0 ? '+' : ''}$${fmtUsd(totals.upnl)}`}
              color={totals.upnl >= 0 ? '#34C759' : '#FF3B30'}
            />
          </div>

          {attestation && (
            <div
              className="mb-3 rounded-lg p-2.5 text-[11px] leading-relaxed"
              style={{
                background: attestation.attested ? `${ACCENT}0d` : '#FF950012',
                border: `1px solid ${attestation.attested ? `${ACCENT}30` : '#FF950030'}`,
              }}
            >
              <div className="flex items-start gap-2">
                <Anchor
                  className="w-3.5 h-3.5 flex-shrink-0 mt-0.5"
                  style={{ color: attestation.attested ? ACCENT : '#FF9500' }}
                />
                <div className="flex-1 min-w-0">
                  {attestation.attested ? (
                    <>
                      <div className="font-semibold text-label-primary">
                        Entry snapshot anchored to Hedera Consensus Service
                      </div>
                      <div className="text-label-secondary text-[10.5px] mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
                        {typeof attestation.finalityMs === 'number' && (
                          <span>Finality: <span className="tabular-nums font-semibold">{(attestation.finalityMs / 1000).toFixed(2)}s</span></span>
                        )}
                        {attestation.consensusTimestamp && (
                          <span>Seq: <span className="tabular-nums font-semibold">#{attestation.consensusTimestamp}</span></span>
                        )}
                        {attestation.explorerUrl && (
                          <a
                            href={attestation.explorerUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 font-semibold hover:underline"
                            style={{ color: ACCENT }}
                          >
                            View on HashScan <ExternalLink className="w-2.5 h-2.5" />
                          </a>
                        )}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="font-semibold text-label-primary">HCS attestation skipped</div>
                      <div className="text-label-secondary text-[10.5px] mt-0.5">
                        {attestation.reason || 'unavailable'}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            {positions.map((p) => {
              const priceRow = prices[p.symbol];
              const mark = priceRow?.price ?? p.entryPrice;
              const change24h = priceRow?.change24h;
              const isHold = p.side === 'HOLD';
              const dirMul = p.side === 'LONG' ? 1 : p.side === 'SHORT' ? -1 : 0;
              const pnl = (mark - p.entryPrice) * p.sizeToken * dirMul;
              const pnlPct = p.marginUsd > 0 ? (pnl / p.marginUsd) * 100 : 0;
              const winning = pnl >= 0;
              const sideBg = p.side === 'LONG' ? '#34C75915' : p.side === 'SHORT' ? '#FF3B3015' : '#8E8E9315';
              const sideColor = p.side === 'LONG' ? '#34C759' : p.side === 'SHORT' ? '#FF3B30' : '#8E8E93';
              return (
                <div key={p.symbol} className="flex items-center gap-2 p-2 rounded-lg bg-system-bg-secondary text-[12px]">
                  <div className="flex items-center gap-1.5 flex-1 min-w-0">
                    {p.side === 'LONG' && <TrendingUp className="w-3.5 h-3.5 text-[#34C759] flex-shrink-0" />}
                    {p.side === 'SHORT' && <TrendingDown className="w-3.5 h-3.5 text-[#FF3B30] flex-shrink-0" />}
                    {isHold && <Activity className="w-3.5 h-3.5 text-[#8E8E93] flex-shrink-0" />}
                    <span className="font-semibold text-label-primary w-10">{p.symbol}</span>
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold"
                      style={{ background: sideBg, color: sideColor }}
                    >
                      {p.side}
                    </span>
                    {!isHold && (
                      <span className="text-[10px] text-label-tertiary">{p.leverage}×</span>
                    )}
                    {p.signalConfidence > 0 && (
                      <span
                        className="text-[10px] px-1.5 py-0.5 rounded font-semibold"
                        style={{ background: `${ACCENT}15`, color: ACCENT }}
                        title={`Signal: ${p.signalDirection} · confidence ${p.signalConfidence}% · min conviction ${MIN_CONVICTION_PCT}%`}
                      >
                        {p.signalDirection} {p.signalConfidence}%
                      </span>
                    )}
                    {typeof change24h === 'number' && (
                      <span
                        className="text-[10px] tabular-nums"
                        style={{ color: change24h >= 0 ? '#34C759' : '#FF3B30' }}
                        title="24h price change"
                      >
                        24h {fmtPct(change24h)}
                      </span>
                    )}
                  </div>
                  <div className="text-right flex-shrink-0">
                    {isHold ? (
                      <>
                        <div className="text-[11px] text-label-tertiary" title="Signal below min conviction — capital sits in USDC">
                          in USDC
                        </div>
                        <div className="text-[10px] text-label-tertiary tabular-nums">
                          ${fmtUsd(poolNavUsd * ASSET_ALLOCATION)}
                        </div>
                      </>
                    ) : (
                      <>
                        <div
                          className="font-semibold tabular-nums text-[12px]"
                          style={{ color: winning ? '#34C759' : '#FF3B30' }}
                        >
                          {winning ? '+' : ''}${fmtUsd(pnl)}
                        </div>
                        <div className="text-[10px] tabular-nums" style={{ color: winning ? '#34C759' : '#FF3B30' }}>
                          {winning ? '+' : ''}{pnlPct.toFixed(2)}%
                        </div>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-3 pt-2 border-t border-gray-100 dark:border-gray-700 flex items-start gap-1.5 text-[10px] text-label-tertiary leading-relaxed">
            <Info className="w-3 h-3 flex-shrink-0 mt-0.5" />
            <span>
              No on-chain perp DEX on Hedera testnet yet — sizes + P&amp;L are
              projected against live marks. Entry snapshot is anchored to HCS
              so the numbers can't be back-fit after price moves.
            </span>
          </div>
        </>
      )}
    </div>
  );
}

function StatCell({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-lg bg-system-bg-secondary p-2">
      <div className="text-[10px] text-label-tertiary uppercase tracking-wide">{label}</div>
      <div className="text-[13px] font-semibold tabular-nums" style={{ color: color ?? 'inherit' }}>
        {value}
      </div>
    </div>
  );
}
