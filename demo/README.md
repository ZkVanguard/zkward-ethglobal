# Demo — ZkWard × ETHGlobal Online 2026

Everything needed to record and submit the 3-min sponsor-track demo.

## Recording checklist

- [ ] Browser at 1440×900, bookmark bar hidden
- [ ] Cookie banner dismissed on `zkward.com` (accept once, refresh, done)
- [ ] Tabs pre-loaded in order (see [Cheat sheet](#cheat-sheet) below)
- [ ] Terminal ready: `bun run scripts/demo-x402-permit.ts` (paste-ready, don't press Enter yet)
- [ ] Warm caches: `curl -sf https://www.zkward.com/api/judges/status | jq '.passed'` → must be 13
- [ ] Water sip · dry run once · record

## Cheat sheet — 7 chapters × ~30s = 3:00 total

| # | Time | SHOW (tab / URL) | POINT at | SAY (verbatim) |
|---|---|---|---|---|
| **1** | 0:00–0:20 | `www.zkward.com` | Hero: **"$60.1K Pool NAV"**, "USDC 100%", "Hedera Testnet" pill | "ZkWard is a multi-chain AI-managed stablecoin vault. Live on **Hedera Testnet with 60 grand deposited**, also running on SUI mainnet since June — real users, real capital, seven AI agents allocating autonomously." |
| **2** | 0:20–0:55 | `www.zkward.com/api/x402/permit-demo?asset=BTC` (raw JSON) | Fields: `scheme: "permit-2612"`, `asset: 0xe40A…A0b`, `facilitator: "inline"`, `chainId: 296` | "**Hedera track — AI & Agentic Payments.** Every inference call is metered on-chain. Agent hits our endpoint, gets HTTP 402 with an EIP-2612 permit intent, signs $0.0001 worth of USDC, replays — settled, receipt on HCS." |
| **3** | 0:55–1:15 | Terminal → paste + Enter `bun run scripts/demo-x402-permit.ts` | Output: `verification.mode: 'zkward-eip2612'`, `hashscan.io/testnet/transaction/...` | "One command. Ephemeral wallet, real faucet mint, real signed permit, real 200 OK. Not a stub — the receipt is anchored on HCS topic `0.0.10393879`." |
| **4** | 1:15–1:45 | Studio playground (see [URL](#preloaded-studio-playground-url) below) — press **Play** | `_meta.deployment: "QmZghNU…"` (IPFS hash), `pools[0].network: "sepolia"`, real transactions | "**Graph track — Composable Standardized.** One GraphQL schema, two backends. Studio subgraph on Sepolia — account 1758819 is mine, IPFS deployment hash is content-addressed. Same schema is served on Hedera by our npm package." |
| **5** | 1:45–2:15 | `www.zkward.com/dashboard` → **Multi-chain AI Vaults** panel | Both cards: **Sepolia $1,985 TVL** left, **Hedera $60,070 TVL** right, both "ok" | "Same query fires against both. Left: Studio. Right: our adapter reading Hedera Mirror Node. The Graph doesn't index Hedera natively — 129 EVM chains, Hedera not among them — so we shipped the bridge as open-source npm." |
| **6** | 2:15–2:40 | `/dashboard` → **Sign In** → Privy modal | Modal: **email / Google / wallet** options | "**Privy track — Financial Flow + B2B.** Users log in with email, get an embedded wallet, deposit — no seed phrase. For institutional actions we layer N-of-M quorum on the admin endpoint. One integration, both surfaces." |
| **7** | 2:40–3:00 | `www.zkward.com/judges` | **13 / 13 green** pill + check list + **"Explore the subgraph"** section with both playground links | "Every claim green, right now. Thirteen live checks against Mirror Node, HCS, our routes, Graph Studio, Apollo Sandbox on Hedera, npm. Refresh any time. Bridged, standardized, verifiable, shipped." |

**Kill list — do NOT say:** so / basically / essentially / um / kind of / hypothetical / if it worked / in theory.

## Preloaded Studio playground URL

Copy → paste in browser Tab 4. Loads GraphiQL with a query pre-populated; press Play to execute.

```
https://api.studio.thegraph.com/query/1758819/zkward/v0.2.0/graphql?query=%7B%20_meta%20%7B%20deployment%20block%20%7B%20number%20%7D%20hasIndexingErrors%20%7D%20pools%20%7B%20id%20network%20totalNav%20totalShares%20memberCount%20transactions(first%3A%205%2C%20orderBy%3A%20timestamp%2C%20orderDirection%3A%20desc)%20%7B%20type%20actor%20amount%20timestamp%20%7D%20%7D%20members%20%7B%20address%20currentShares%20totalDeposited%20%7D%20%7D
```

## Screenshot inventory

Captured at 1440×900. `demo-01`, `demo-04`, `demo-07`, `demo-08`, `verify-judges-13-of-13` refreshed 2026-09-12 (dual-playground /judges section + Apollo Sandbox on Hedera + fresh Sepolia GraphiQL execution). Superseded originals archived under `demo/screenshots/archive-2026-09-12/`. Other shots captured 2026-09-10. Live in `demo/screenshots/`.

### Chapter fallbacks (use if a live tab is slow)

| Chapter | File | Contents |
|---|---|---|
| 1 | `demo-01-homepage-hero.png` | Homepage hero, $60.1K Pool NAV, Hedera Testnet pill |
| 2 | `x402-permit-demo-402-response.png` | Raw JSON 402 response with permit-2612 scheme |
| 3 | `demo-03-terminal-paid-call.png` | Clean terminal render of the paid-call script output |
| 4 | `demo-04-studio-playground.png` | GraphiQL with the executed query — real Sepolia data ($1,985 TVL, sepolia network) |
| 4b | `demo-08-hedera-apollo-sandbox.png` | Apollo Sandbox → our Hedera adapter with the SAME query — real Hedera data ($60,070 TVL, hedera-testnet). Side-by-side with #4 = the parity proof shot. |
| 5 | `demo-05-multichain-panel-1440.png` | Dashboard Multi-chain panel: both backends live |
| 6 | `demo-06-privy-modal.png` | Privy sign-in sheet: email / Google / wallet |
| 7 | `demo-07-judges-live.png` | `/judges` page: 13/13 green + first checks visible + dual-playground section |

### On-chain proof (if judge asks "prove it")

| File | Contents |
|---|---|
| `hashscan-hcs-audit-anchor.png` | HashScan SUBMIT_MESSAGE for a paid-call HCS receipt |
| `hashscan-faucet-mint-tx.png` | Real Hedera testnet mint tx from the demo script |

### Dashboard cross-references

| File | Contents |
|---|---|
| `dashboard-agent-payments-tab.png` | x402 agent-payments dashboard tab |
| `dashboard-x402-tab.png` | Same tab, fresh browser |
| `dashboard-hedges-panel-fixed.png` | Projected pool hedges after HOLD-gate fix |
| `dashboard-pnl-scaled-10k.png` | Projected hedges after seeding to $60k NAV |
| `multichain-panel-parity-live.png` | Multi-chain panel at tablet width |

### Responsive proof (if judge asks "does it work on mobile?")

| File | Viewport |
|---|---|
| `dash-320-final.png` | iPhone SE 1st gen (320×568) — 0 overflows |
| `dash-375-final.png` | iPhone SE / 12 mini (375×812) — 0 overflows |
| `dash-1920-final.png` | Large desktop (1920×1080) — clean |

**Certification:** 42 combinations tested (7 pages × 6 viewports). Zero non-intentional overflows. See `audit-iterations/` for before/after iteration proof.

## Related scripts (in repo)

| Script | Purpose |
|---|---|
| `scripts/demo-x402-permit.ts` | Full paid-call end-to-end (Chapter 3) |
| `scripts/demo-graph-parity.ts` | Cross-chain schema parity (backup for Chapter 5) |
| `scripts/demo-signals.ts` | AI signal replay (optional backup) |
| `mcp/zkward-vaults/test-e2e.mjs` | MCP tool e2e (optional Chapter 4 extension) |

## Related docs (in repo)

| Doc | Purpose |
|---|---|
| `docs/DEMO_VIDEO_PLATFORM.md` | Full prose script + all context (this README is the glance-during-record version) |
| `docs/DEMO_VIDEO_SCRIPTS.md` | Legacy per-prize scripts (older, superseded) |
| `docs/guides/TESTNET_DEMO_GUIDE.md` | Original Cronos-era demo guide (historical) |

## Prize-mapping cheat sheet (paste into submission forms)

| Track | Prize | Evidence in this video |
|---|---|---|
| Graph — Composable/Standardized | $5K | Chapter 4 (Studio subgraph + IPFS proof) |
| Graph — AI Tooling (Continuity) | $5K | Chapter 5 (adapter serves same schema) |
| Hedera — AI & Agentic Payments | $6K | Chapters 2-3 (x402 + HCS + real EIP-2612) |
| Hedera — Continuity | $1K | Chapter 1 (SUI mainnet lineage + Hedera new chapter) |
| Privy — Best Financial Flow | $2.5K | Chapter 6 (email login → embedded wallet → deposit) |
| Privy — Best B2B | $2.5K | Chapter 6 (quorum-action endpoint mention) |

## Assets (paste into submission forms)

- Public repo: `https://github.com/ZkVanguard/zkward-ethglobal`
- Live product: `https://www.zkward.com`
- Judges dashboard: `https://www.zkward.com/judges`
- npm package: `https://www.npmjs.com/package/@zkward/hedera-graphql-adapter`
- Graph Studio subgraph: `https://api.studio.thegraph.com/query/1758819/zkward/v0.2.0`
- x402 endpoint: `https://www.zkward.com/api/x402/permit-demo?asset=BTC`
- HCS audit topic: `0.0.10393879` — https://hashscan.io/testnet/topic/0.0.10393879
- HCS-14 registry: `0.0.10401316` — https://hashscan.io/testnet/topic/0.0.10401316
- Hedera vault contract: `0x18a8d89E3674EBCeC678f97A8a8b1D144b330b88`
- SUI mainnet pool: `0x107292a69eea2f6eaf4a4e4727ee25d747b04c1985441b138933f0ef33f7b726`

## Proof-of-authorship anchors

- Studio account ID `1758819` — assignable only to my Studio login
- IPFS deployment hash `QmZghNUW8goywMs9kU6F824sDVzs2AZo47jCsSqBTKwbu7` (returned by `_meta.deployment`) — content-addressed, immutable
- npm scope `@zkward` — owned by my npm account
- GitHub commits under my username at `ZkVanguard/zkward-ethglobal`
