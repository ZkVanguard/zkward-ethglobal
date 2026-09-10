/**
 * demo-x402-permit — end-to-end real paid x402 call on Hedera testnet.
 *
 * Runs the full x402 handshake against /api/x402/permit-demo, paying with
 * a real EIP-2612 permit signed against MockERC20Permit (Hedera testnet).
 *
 * Flow:
 *   1. Ephemeral wallet (or DEMO_PRIVATE_KEY if provided)
 *   2. Faucet: POST /api/hedera/faucet (mints 100 test USDC + 1 HBAR)
 *   3. Fetch 402 payment intent
 *   4. Read on-chain nonce from MockERC20Permit
 *   5. Sign EIP-2612 permit (owner→spender=payTo, value=intent.amount)
 *   6. Base64-encode {owner,spender,value,nonce,deadline,v,r,s} as X-PAYMENT
 *   7. Retry endpoint with X-PAYMENT — expect 200 + verification.mode='zkward-eip2612'
 *
 * Run:
 *   bun run scripts/demo-x402-permit.ts
 *   bun run scripts/demo-x402-permit.ts --local        # against localhost:3000
 *   DEMO_PRIVATE_KEY=0x… bun run scripts/demo-x402-permit.ts   # reuse a wallet
 */

import { Wallet, JsonRpcProvider, Contract, TypedDataEncoder, Signature } from 'ethers';

const HEDERA_TESTNET_RPC = 'https://testnet.hashio.io/api';
const BASE_URL = process.argv.includes('--local')
  ? 'http://localhost:3000'
  : (process.env.DEMO_BASE_URL || 'https://www.zkward.com');
const ENDPOINT = `${BASE_URL}/api/x402/permit-demo?asset=BTC`;
const FAUCET_URL = `${BASE_URL}/api/hedera/faucet`;

const PERMIT_ABI = [
  'function nonces(address owner) view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function DOMAIN_SEPARATOR() view returns (bytes32)',
];

function line(s = '') {
  process.stdout.write(s + '\n');
}

async function main() {
  line('\n═══════════════════════════════════════════════════════════════');
  line('  x402 permit-demo — real paid call on Hedera testnet');
  line('═══════════════════════════════════════════════════════════════');
  line(`  Endpoint : ${ENDPOINT}`);
  line(`  Faucet   : ${FAUCET_URL}`);

  const provider = new JsonRpcProvider(HEDERA_TESTNET_RPC);
  const wallet = process.env.DEMO_PRIVATE_KEY
    ? new Wallet(process.env.DEMO_PRIVATE_KEY.trim(), provider)
    : Wallet.createRandom().connect(provider);
  line(`  Signer   : ${wallet.address}`);
  if (!process.env.DEMO_PRIVATE_KEY) {
    line(`  (ephemeral — set DEMO_PRIVATE_KEY=${wallet.privateKey} to reuse)`);
  }

  // ─── Step 1: 402 intent ───────────────────────────────────────────
  line('\n[1/5] Fetching 402 payment intent…');
  const r1 = await fetch(ENDPOINT);
  if (r1.status !== 402) throw new Error(`expected 402, got ${r1.status}`);
  const intent = (await r1.json()) as {
    accepts: Array<{
      asset: string;
      payTo: string;
      maxAmountRequired: string;
      extra: { chainId: number; tokenName: string; tokenVersion: string; faucetUrl: string };
    }>;
    facilitator: string;
  };
  const req = intent.accepts[0];
  line(`      asset      = ${req.asset}`);
  line(`      payTo      = ${req.payTo}`);
  line(`      amount     = ${req.maxAmountRequired} micros`);
  line(`      chainId    = ${req.extra.chainId}`);
  line(`      facilitator= ${intent.facilitator}`);

  // ─── Step 2: faucet ───────────────────────────────────────────────
  line('\n[2/5] Requesting testnet USDC + HBAR from faucet…');
  const drip = await fetch(FAUCET_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ address: wallet.address }),
  });
  const dripBody = (await drip.json()) as { ok?: boolean; error?: string; txHash?: string };
  if (!drip.ok || !dripBody.ok) {
    line(`      ⚠ faucet said: ${dripBody.error || 'unknown'}`);
    line(`      (continuing — signature verification does not require balance)`);
  } else {
    line(`      ✓ minted; usdc tx ${dripBody.txHash}`);
  }

  // ─── Step 3: on-chain nonce ───────────────────────────────────────
  line('\n[3/5] Reading on-chain permit nonce + balance…');
  const usdc = new Contract(req.asset, PERMIT_ABI, provider);
  const [nonce, balance] = await Promise.all([
    usdc.nonces(wallet.address) as Promise<bigint>,
    usdc.balanceOf(wallet.address) as Promise<bigint>,
  ]);
  line(`      nonce   = ${nonce}`);
  line(`      balance = ${balance} micros (${Number(balance) / 1e6} USDC)`);
  const deadline = Math.floor(Date.now() / 1000) + 600;

  // ─── Step 4: sign EIP-2612 permit ─────────────────────────────────
  line('\n[4/5] Signing EIP-2612 permit…');
  const domain = {
    name: req.extra.tokenName,
    version: req.extra.tokenVersion,
    chainId: req.extra.chainId,
    verifyingContract: req.asset,
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
    owner: wallet.address,
    spender: req.payTo,
    value: req.maxAmountRequired,
    nonce,
    deadline,
  };
  const signature = await wallet.signTypedData(domain, types, message);
  const sig = Signature.from(signature);

  const payload = {
    owner: wallet.address,
    spender: req.payTo,
    value: req.maxAmountRequired,
    nonce: nonce.toString(),
    deadline,
    v: sig.v,
    r: sig.r,
    s: sig.s,
  };
  const xPayment = Buffer.from(JSON.stringify(payload)).toString('base64');
  line(`      v=${sig.v} r=${sig.r.slice(0, 12)}…  s=${sig.s.slice(0, 12)}…`);

  // Sanity — recover locally so a mismatch fails fast before hitting the server.
  const digest = TypedDataEncoder.hash(domain, types, message);
  const { recoverAddress } = await import('ethers');
  const recoveredLocal = recoverAddress(digest, sig);
  if (recoveredLocal.toLowerCase() !== wallet.address.toLowerCase()) {
    throw new Error(`local recovery mismatch: ${recoveredLocal} vs ${wallet.address}`);
  }
  line(`      ✓ local recovery matches signer`);

  // ─── Step 5: replay with X-PAYMENT ────────────────────────────────
  line('\n[5/5] Retrying endpoint with X-PAYMENT header…');
  const r2 = await fetch(ENDPOINT, { headers: { 'X-PAYMENT': xPayment } });
  const bodyText = await r2.text();
  let body: unknown;
  try { body = JSON.parse(bodyText); } catch { body = bodyText; }
  line(`      status = ${r2.status}`);
  const resp = body as {
    verification?: { valid: boolean; mode: string; note: string; recovered?: string };
    signal?: string;
    confidence?: number;
    reasoning?: string;
    source?: string;
    hcs?: { explorerUrl?: string; error?: string };
  };
  if (r2.status !== 200) {
    line('      ✗ FAILED');
    line(`      body   = ${JSON.stringify(body, null, 2)}`);
    process.exit(1);
  }
  line('      ✓ 200 OK');
  line(`\n─── verification ───────────────────────────────────────────────`);
  line(`  valid     : ${resp.verification?.valid}`);
  line(`  mode      : ${resp.verification?.mode}`);
  line(`  recovered : ${resp.verification?.recovered}`);
  line(`  note      : ${resp.verification?.note}`);
  line(`\n─── signal ─────────────────────────────────────────────────────`);
  line(`  asset     : BTC`);
  line(`  signal    : ${resp.signal}`);
  line(`  confidence: ${resp.confidence}%`);
  line(`  source    : ${resp.source}`);
  line(`  reasoning : ${resp.reasoning?.slice(0, 120)}…`);
  if (resp.hcs?.explorerUrl) {
    line(`\n─── HCS audit ──────────────────────────────────────────────────`);
    line(`  ${resp.hcs.explorerUrl}`);
  } else if (resp.hcs?.error) {
    line(`\n  (HCS anchor skipped: ${resp.hcs.error})`);
  }
  line('\n═══════════════════════════════════════════════════════════════');
  line('  DONE — real paid x402 call verified.');
  line('═══════════════════════════════════════════════════════════════\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
