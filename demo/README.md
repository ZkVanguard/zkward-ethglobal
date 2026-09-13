# Demo — ZkWard × ETHGlobal Online 2026

Everything needed to record and submit the 3-min sponsor-track demo.

## Recording checklist

- [ ] Browser at 1440×900, bookmark bar hidden, DevTools closed
- [ ] Cookie banner dismissed on `zkward.com` (accept once, refresh, done)
- [ ] **6 tabs pre-loaded in this exact order** (all URLs in [Tab-load URLs](#tab-load-urls-copy-paste)):
  1. `www.zkward.com`
  2. `/api/x402/permit-demo?asset=BTC` (raw JSON view)
  3. Studio GraphiQL — pre-populated query, auto-runs on load
  4. Apollo Sandbox — pre-populated query on Hedera adapter
  5. `www.zkward.com/dashboard` (signed out — Privy sign-in in Chapter 5)
  6. `www.zkward.com/judges`
- [ ] Terminal window open, `bun run scripts/demo-x402-permit.ts` typed but NOT run
- [ ] Warm caches (must return the exact values):
  - `curl -sf https://www.zkward.com/api/judges/status | jq '.passed'` → **13**
  - `curl -sf https://www.zkward.com/api/subgraph/hedera -X POST -H 'content-type: application/json' -d '{"query":"{ pools { totalNav } }"}' | jq '.data.pools[0].totalNav'` → **"60070000000"**
- [ ] Water sip · dry run once end-to-end · record on 2nd take

## Cheat sheet — 6 chapters, 3:00 total (tightened flow)

Each cell has 3 rows: **SHOW** (which tab, what to click), **POINT** (what your cursor / eye is drawn to), **SAY** (verbatim script — 40–60 words to hit the time budget).

| # | Time | SHOW · POINT · SAY |
|---|---|---|
| **1** | 0:00–0:20 (20s) | **SHOW:** Tab 1 · `www.zkward.com` <br> **POINT:** Hero card — **"$60.1K"** TVL, **"Hedera Testnet · SimpleUsdcVault · 2 members"** pill, "USDC 100%" bar <br> **SAY:** "ZkWard is a multi-chain autonomous stablecoin vault. Sixty thousand deposited on Hedera Testnet, also running on SUI mainnet since June — real capital, seven AI agents allocating in real time. Every one of the sponsor tracks — Hedera, The Graph, Privy — is live behind this hero." |
| **2** | 0:20–1:00 (40s) | **SHOW:** Tab 2 (raw 402 JSON), then Alt-Tab to terminal, paste + Enter `bun run scripts/demo-x402-permit.ts` <br> **POINT:** JSON → fields `scheme: "permit-2612"`, `asset: 0xe40A…`, `chainId: 296`. Terminal → **`verification.mode: 'zkward-eip2612'`** + **`hashscan.io/testnet/transaction/…`** URL <br> **SAY:** "**Hedera track — AI & Agentic Payments.** Any agent hits our endpoint, gets HTTP 402 with an EIP-2612 permit intent. One command signs a real USDC permit, replays with the X-PAYMENT header, gets 200 — receipt anchored on HCS topic `0.0.10393879`. Sub-cent metering, verifiable on HashScan." |
| **3** | 1:00–1:45 (45s) | **SHOW:** Tab 3 (Studio GraphiQL — Sepolia) → Tab 4 (Apollo Sandbox — Hedera). Both already have identical query loaded; both auto-run. Show them side-by-side visually (Alt-Tab or split window). <br> **POINT:** Left tab response — `"network": "sepolia"`, `"totalNav": "1985000000"`. Right tab response — `"network": "hedera-testnet"`, `"totalNav": "60070000000"`. **Same query. Different chain. Different backend. Identical schema.** <br> **SAY:** "**The Graph track — Composable Standardized + Continuity.** Identical GraphQL query. Left: The Graph Studio subgraph on Sepolia — account 1758819 is mine, IPFS hash `QmZghNU…` is content-addressed. Right: Apollo Sandbox hitting our npm package `@zkward/hedera-graphql-adapter`, reading Hedera Mirror Node live. The Graph doesn't index Hedera — a hundred and twenty-nine EVM chains supported, Hedera not among them. We shipped the bridge, open-source, so any Hedera dApp gets Graph-native tooling." |
| **4** | 1:45–2:15 (30s) | **SHOW:** Tab 5 · `www.zkward.com/dashboard` → **Multi-chain AI Vaults** panel <br> **POINT:** Both vault cards live — **Sepolia $1,985** left, **Hedera $60,070** right, both "ok" badges, both writing to the same in-app view <br> **SAY:** "Aggregated view. Same query stream powers the dashboard. Both TVLs live. Both attested. This is what the schema-parity story looks like inside a product — not a demo trick." |
| **5** | 2:15–2:40 (25s) | **SHOW:** Same tab · click **Sign In** — Privy modal opens <br> **POINT:** Modal — **email / Google / wallet** three-way, no seed phrase prompt <br> **SAY:** "**Privy track — Financial Flow + B2B.** Email or Google login, embedded wallet auto-created, ready to deposit. For institutional actions we layer N-of-M quorum on the admin endpoint. One Privy integration, both consumer and B2B surfaces." |
| **6** | 2:40–3:00 (20s) | **SHOW:** Tab 6 · `www.zkward.com/judges` <br> **POINT:** **"13 / 13 green"** hero pill · scroll to **"Explore the subgraph (same schema, two chains)"** section showing both playground links <br> **SAY:** "Every claim, live-checked, right now. Thirteen checks against Mirror Node, HCS, our routes, both playgrounds, npm. Refresh any time. Bridged. Standardized. Verifiable. Shipped." |

**Kill list — do NOT say:** so / basically / essentially / um / kind of / hypothetical / if it worked / in theory / just / actually / really.

**Timing safety valve:** Chapter 2 is the longest at 40s — if the terminal run is slow (>15s), cut Chapter 2's SAY to the first sentence only ("Any agent hits our endpoint … gets 200") and reclaim 10s for Chapter 3.

## Tab-load URLs (copy-paste)

Open all 6 in order BEFORE recording. Tabs 3 and 4 both auto-execute their query on load — refresh once per take so results are fresh.

```
# Tab 1 — Homepage
https://www.zkward.com

# Tab 2 — x402 402 response (raw JSON view)
https://www.zkward.com/api/x402/permit-demo?asset=BTC

# Tab 3 — The Graph Studio (Sepolia) — GraphiQL, pre-populated + auto-runs
https://api.studio.thegraph.com/query/1758819/zkward/v0.2.0/graphql?query=%7B%20pools%20%7B%20id%20network%20totalNav%20memberCount%20%7D%20_meta%20%7B%20block%20%7B%20number%20%7D%20%7D%20%7D

# Tab 4 — Apollo Sandbox (Hedera) — same query, our adapter, live
https://studio.apollographql.com/sandbox/explorer?endpoint=https%3A%2F%2Fwww.zkward.com%2Fapi%2Fsubgraph%2Fhedera&document=%7B%20pools%20%7B%20id%20network%20totalNav%20memberCount%20%7D%20_meta%20%7B%20block%20%7B%20number%20%7D%20%7D%20%7D

# Tab 5 — Dashboard (signed out — Privy modal comes in Chapter 5)
https://www.zkward.com/dashboard

# Tab 6 — Judges live-check page
https://www.zkward.com/judges
```

**Query used in both Tabs 3 & 4 (same schema, two chains — the parity money shot):**

```graphql
{ pools { id network totalNav memberCount } _meta { block { number } } }
```

Both should return `pools[0].totalNav` — Sepolia `"1985000000"` ($1,985), Hedera `"60070000000"` ($60,070). If those numbers change (someone deposited), update the SAY line in Chapter 1 to match reality.

## Screenshot inventory

Captured at 1440×900. `demo-01`, `demo-04`, `demo-07`, `demo-08`, `verify-judges-13-of-13` refreshed 2026-09-12 (dual-playground /judges section + Apollo Sandbox on Hedera + fresh Sepolia GraphiQL execution). Superseded originals archived under `demo/screenshots/archive-2026-09-12/`. Other shots captured 2026-09-10. Live in `demo/screenshots/`.

### Chapter fallbacks (use if a live tab is slow — cut to still, keep narrating)

| Chapter | File | Contents |
|---|---|---|
| 1 | `demo-01-homepage-hero.png` | Homepage hero, $60.1K Pool NAV, Hedera Testnet pill, new "Multi-chain autonomous vault" title |
| 2a | `x402-permit-demo-402-response.png` | Raw JSON 402 response with permit-2612 scheme |
| 2b | `demo-03-terminal-paid-call.png` | Clean terminal render of the paid-call script output |
| **3-left** | `demo-04-studio-playground.png` | GraphiQL with the executed query — real Sepolia data ($1,985 TVL, sepolia network) |
| **3-right** | `demo-08-hedera-apollo-sandbox.png` | Apollo Sandbox → our Hedera adapter with the SAME query — real Hedera data ($60,070 TVL, hedera-testnet). **Split-screen shot with 3-left is the money frame.** |
| 4 | `demo-05-multichain-panel-1440.png` | Dashboard Multi-chain panel: both backends live |
| 5 | `demo-06-privy-modal.png` | Privy sign-in sheet: email / Google / wallet |
| 6 | `demo-07-judges-live.png` | `/judges` page: 13/13 green + first checks visible + dual-playground section |
| — | `verify-judges-13-of-13.png` | Tight closeup of the "13 / 13 green" pill (use as an inset overlay on Chapter 6) |

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
| Graph — Composable/Standardized | $5K | **Chapter 3 (left)** — Studio subgraph on Sepolia, IPFS deployment hash proof, `_meta.deployment` field visible |
| Graph — AI Tooling (Continuity) | $5K | **Chapter 3 (right)** — Apollo Sandbox pointed at our npm adapter, same query, Hedera data returned live |
| Hedera — AI & Agentic Payments | $6K | **Chapter 2** — x402 402 response + terminal-executed EIP-2612 permit + HCS receipt on HashScan |
| Hedera — Continuity | $1K | **Chapter 1** — hero pill "Hedera Testnet · SimpleUsdcVault" + SAY line naming SUI mainnet lineage |
| Privy — Best Financial Flow | $2.5K | **Chapter 5** — email login → embedded wallet, no seed phrase |
| Privy — Best B2B | $2.5K | **Chapter 5** — SAY line explicitly names the N-of-M quorum admin endpoint layered on top of the same Privy integration |

## Assets (paste into submission forms)

- **Public repo:** `https://github.com/ZkVanguard/zkward-ethglobal`
- **Live product:** `https://www.zkward.com`
- **Judges live-check dashboard:** `https://www.zkward.com/judges` (13/13 live checks, cached 20s, no auth)
- **npm package:** `https://www.npmjs.com/package/@zkward/hedera-graphql-adapter` (v0.6.0)
- **MCP package:** `https://www.npmjs.com/package/@zkward/subgraph-mcp` (v0.2.0)
- **Graph Studio subgraph (Sepolia leg):** `https://api.studio.thegraph.com/query/1758819/zkward/v0.2.0`
- **Hedera adapter endpoint (parity leg):** `https://www.zkward.com/api/subgraph/hedera`
- **x402 endpoint:** `https://www.zkward.com/api/x402/permit-demo?asset=BTC`
- **HCS audit topic:** `0.0.10393879` — https://hashscan.io/testnet/topic/0.0.10393879
- **HCS-14 registry:** `0.0.10401316` — https://hashscan.io/testnet/topic/0.0.10401316
- **Hedera vault contract:** `0x18a8d89E3674EBCeC678f97A8a8b1D144b330b88` — https://hashscan.io/testnet/contract/0.0.10424631
- **SUI mainnet pool:** `0x107292a69eea2f6eaf4a4e4727ee25d747b04c1985441b138933f0ef33f7b726`

**Upstream OSS PRs (contributions to sponsor ecosystems):**
- Hedera Harness: https://github.com/hedera-dev/hedera-harness/pull/43
- Hedera Code Snippets: https://github.com/hedera-dev/hedera-code-snippets/pull/52
- Graph Subgraphs Skills: https://github.com/graphprotocol/subgraphs-skills/pull/1

## Proof-of-authorship anchors

- Studio account ID `1758819` — assignable only to my Studio login
- IPFS deployment hash `QmZghNUW8goywMs9kU6F824sDVzs2AZo47jCsSqBTKwbu7` (returned by `_meta.deployment`) — content-addressed, immutable
- npm scope `@zkward` — owned by my npm account
- GitHub commits under my username at `ZkVanguard/zkward-ethglobal`
