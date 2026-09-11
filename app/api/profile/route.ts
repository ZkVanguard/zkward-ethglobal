/**
 * Wallet display-name profiles.
 *
 * GET  /api/profile?addresses=0xa,0xb,...   → { profiles: { 0xa: { displayName }, ... } }
 * POST /api/profile { address, displayName } → { ok: true } | { error }
 *
 * Auth (POST): trust the `address` field in the body. Hackathon-simple.
 * Production would require an EIP-191 signed message proving ownership;
 * add when name-squatting becomes a real concern.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getWalletProfiles,
  setWalletProfile,
  normalizeAddress,
} from '@/lib/db/wallet-profiles';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const url = new URL(request.url);
  const raw = (url.searchParams.get('addresses') || '').trim();
  if (!raw) return NextResponse.json({ profiles: {} });
  const addrs = raw.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 100);
  const profiles = await getWalletProfiles(addrs);
  return NextResponse.json({ profiles });
}

interface Body { address?: string; displayName?: string }

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: Body = {};
  try { body = (await request.json()) as Body; } catch { /* default */ }
  if (!body.address || !body.displayName) {
    return NextResponse.json({ error: 'address and displayName required' }, { status: 400 });
  }
  if (!normalizeAddress(body.address)) {
    return NextResponse.json({ error: 'invalid address' }, { status: 400 });
  }
  const res = await setWalletProfile(body.address, body.displayName);
  if ('error' in res) {
    return NextResponse.json({ error: res.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
