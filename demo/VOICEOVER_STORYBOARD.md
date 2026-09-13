# Voiceover Storyboard — 3:00 Recording Script

Full shooting-script for the ETHGlobal 2026 sponsor-track submission.
Left column = **what plays on screen**, right column = **what you say**, top
row = **timing budget**. Read it in split-screen while you record.

Paired with [`README.md`](./README.md) (cheat sheet) and the current
[`screenshots/`](./screenshots/) folder. If a live tab hangs during the
take, cut to the referenced still and keep narrating — the cheat sheet
lists which still matches which beat.

---

## Voiceover changes vs your draft

Five surgical tightenings. All net-shorter, no story lost.

| # | Before | After | Why |
|---|---|---|---|
| 1 | "So, this is ZkWard…" | "This is ZkWard —" | Cuts kill-list "So" |
| 2 | "Now, with a single command, we sign…" | "One command signs the real USDC permit…" | Cuts kill-list "Now"; active voice |
| 3 | "…and we get a 200 response." | "**200 OK. Signed. Settled.** Receipt on-chain." | Anticlimactic → punchy |
| 4 | "Now here's the part I'm particularly excited about." | "Here's the payoff." | Cuts hedge ("particularly") |
| 5 | "It just consumes the same schema." | "It consumes the same schema." | Cuts kill-list "just" |

Everything else — including your closing chant — keep verbatim. It works.

---

## Global recording setup

- **Viewport:** 1440×900 (window, not full-screen — chrome visible for realism)
- **Bookmark bar:** hidden (`Cmd/Ctrl+Shift+B`)
- **DevTools:** closed
- **6 tabs preloaded** in this exact order (URLs in [`README.md`](./README.md) → *Tab-load URLs*):
  1. Homepage
  2. `/api/x402/permit-demo?asset=BTC` (raw JSON)
  3. Studio GraphiQL (Sepolia) — query pre-populated, auto-runs
  4. Apollo Sandbox (Hedera adapter) — same query, pre-populated
  5. `/dashboard` (signed out)
  6. `/judges`
- **Terminal window:** 2nd monitor if possible, or Alt-Tab. Command typed but NOT executed: `bun run scripts/demo-x402-permit.ts`
- **Pre-recording warm-up curls** (must return exact values):
  ```bash
  curl -sf https://www.zkward.com/api/judges/status | jq '.passed'
  # → 13
  curl -sf -X POST https://www.zkward.com/api/subgraph/hedera \
    -H 'content-type: application/json' \
    -d '{"query":"{ pools { totalNav } }"}' | jq '.data.pools[0].totalNav'
  # → "60070000000"
  ```
- **Take strategy:** dry-run once end-to-end silent, then record on the 2nd take.

---

## Chapter 1 · 0:00–0:20 · Opening (20s budget)

**TAB:** 1 · `www.zkward.com`

| Second | On screen (visual choreography) | Voiceover |
|---|---|---|
| 0:00 | Homepage loaded. Cursor OFF-screen. | *(silent breath — half beat before speaking)* |
| 0:02 | Cursor enters from top-left, drifts toward the **"$60.1K"** TVL card | "This is **ZkWard** — a multi-chain autonomous stablecoin vault." |
| 0:07 | Cursor pauses briefly on **"Hedera Testnet · SimpleUsdcVault · 2 members"** pill | *(short pause)* "Over **sixty thousand dollars** deposited on Hedera Testnet right now." |
| 0:12 | Cursor moves to the USDC 100% allocation bar | "The same system is also running on **SUI mainnet**." |
| 0:16 | Cursor moves off, settle on hero for final beat | "Behind the scenes, **seven AI agents** are allocating capital in real time." |

**Fallback still:** `demo-01-homepage-hero.png`
**Pace guardrail:** if 0:20 approaches and you haven't hit "seven AI agents," compress last line to "Seven AI agents allocating in real time." Skip nothing that names the chain.

---

## Chapter 2 · 0:20–1:00 · Hedera / x402 (40s budget)

**TAB:** 2 (raw JSON), then Alt-Tab → **terminal**.

| Second | On screen | Voiceover |
|---|---|---|
| 0:20 | Alt-Tab to Tab 2 — raw 402 JSON fills screen. Cursor idle. | "In this demo, three things: **agentic payments, cross-chain data, and the financial flow**. Let's start with **Hedera**." |
| 0:28 | Cursor hovers on `"scheme": "permit-2612"`, then drops to `"asset": "0xe40A…"` | "Our agent hits this endpoint — instead of getting rejected, it gets an **HTTP 402** payment request with an **EIP-2612 permit intent**." |
| 0:40 | Alt-Tab to terminal. Highlight the pre-typed command. Press **Enter**. | "One command signs the real USDC permit, replays with the **X-PAYMENT** header…" |
| 0:45 | Terminal shows script output scrolling — wait for `verification.mode: 'zkward-eip2612'` line to appear | *(silent — let terminal breathe 2s)* |
| 0:50 | Point cursor at `verification.mode: 'zkward-eip2612'` line | "**200 OK. Signed. Settled.**" *(short pause)* "Receipt anchored on **HCS topic 0.0.10393879**." |
| 0:56 | Point cursor at the `hashscan.io/testnet/transaction/…` URL below | "Sub-cent metering. Independently verifiable on HashScan." |

**Fallback stills:** `x402-permit-demo-402-response.png` (0:20–0:40) and `demo-03-terminal-paid-call.png` (0:40–1:00). Both are pre-captured — cut to them and keep talking if the terminal is slow.
**Timing safety valve:** if the terminal takes >15s to complete, skip the "Sub-cent metering" line and jump straight to Chapter 3.

---

## Chapter 3 · 1:00–1:45 · The Graph / cross-chain parity (45s budget) · **money shot**

**TABS:** 3 (Studio GraphiQL) and 4 (Apollo Sandbox), Alt-Tabbed side by side.

| Second | On screen | Voiceover |
|---|---|---|
| 1:00 | Alt-Tab to Tab 3 (Studio). Query auto-ran; result panel shows `"network": "sepolia"`, `"totalNav": "1985000000"` | "Here's the payoff. I'll run the **same GraphQL query** against two different chains." |
| 1:08 | Cursor on the response JSON, especially on `"network": "sepolia"` | "On the left — **The Graph's Studio subgraph on Sepolia**. Real data, IPFS-hashed deployment." |
| 1:15 | Alt-Tab to Tab 4 (Apollo Sandbox). Query already loaded and ran. Result: `"network": "hedera-testnet"`, `"totalNav": "60070000000"` | "On the right — **Apollo Sandbox** querying our **Hedera adapter**." |
| 1:22 | Cursor lingers on both response panels — flick between tabs if possible | *(slower, deliberate)* "Same query. Different chain. Different backend." |
| 1:28 | Full pause. Cursor still. | *(emphatic)* "But **the same schema.**" |
| 1:32 | Alt-Tab back to Tab 3, then Tab 4 quickly (visual back-and-forth) | "That's the point. The Graph doesn't currently index Hedera — a hundred and twenty-nine EVM chains supported, Hedera not among them." |
| 1:40 | Cursor returns to Tab 4 (Hedera response) | "So we shipped the bridge as open-source npm. Any Hedera dApp gets Graph-native tooling." |

**Fallback:** split-screen composite of `demo-04-studio-playground.png` + `demo-08-hedera-apollo-sandbox.png` (create in post if needed — they're both 1440×900).
**This is your money shot — do not rush. If you're 5s over budget, take it from Chapter 5 (Privy).**

---

## Chapter 4 · 1:45–2:15 · Multi-chain dashboard (30s budget)

**TAB:** 5 · `/dashboard`.

| Second | On screen | Voiceover |
|---|---|---|
| 1:45 | Alt-Tab to Tab 5. Scroll (or already scrolled) to **Multi-chain AI Vaults** panel. Both cards visible: Sepolia $1,985 left, Hedera $60,070 right. | "This is where that becomes useful inside the actual product." |
| 1:52 | Cursor pans between the two cards | "Both vaults, same dashboard. Sepolia on one side, Hedera on the other." |
| 2:00 | Point at the "ok" status badge on each card | "Both TVLs live. Both independently attested." |
| 2:05 | Cursor moves off, settle on the whole panel | "The dashboard doesn't care that these came from different backends. It consumes the same schema." |
| 2:10 | *(hold — let the shot breathe)* | "That's what cross-chain standardization looks like once it moves from a demo into an actual application." |

**Fallback still:** `demo-05-multichain-panel-1440.png`

---

## Chapter 5 · 2:15–2:40 · Privy (25s budget)

**TAB:** 5 (same dashboard). Click **Sign In**.

| Second | On screen | Voiceover |
|---|---|---|
| 2:15 | Click **Sign In** button in the top-right | "And finally, the user flow." |
| 2:18 | Privy modal opens — three options: email, Google, wallet | "With **Privy**, a user signs in with email, Google, or wallet." |
| 2:24 | Cursor hovers on the email option (do NOT click through — modal alone is the shot) | "An embedded wallet is created automatically — no seed phrase, no setup delay." |
| 2:30 | Cursor moves off the modal, back to dashboard visible behind | "For institutional operations, we layer **N-of-M quorum authorization** on the admin endpoint." |
| 2:36 | *(hold on the modal, half-beat before closing chapter)* | "One integration, both surfaces — **consumer and B2B**." |

**Fallback still:** `demo-06-privy-modal.png`
**If Privy modal is slow to open:** cut to still at 2:18 and talk over it.

---

## Chapter 6 · 2:40–3:00 · Proof + close (20s budget)

**TAB:** 6 · `/judges`.

| Second | On screen | Voiceover |
|---|---|---|
| 2:40 | Alt-Tab to Tab 6 · `/judges` page. Scroll to top — **"13 / 13 green"** pill visible | "We don't expect you to take any of this on faith." |
| 2:44 | Cursor points at the **"13 / 13 green"** pill | "This page is our live verification layer. **Thirteen checks, all passing** right now." |
| 2:50 | Scroll (or highlight) the check list briefly | "Mirror Node integration, HCS receipts, our API routes, both Graph playgrounds, npm. Everything you saw — live, independently verifiable." |
| 2:55 | Cursor settles on the "13 / 13 green" pill. Full stop. | *(short pause)* "**ZkWard.**" |
| 2:58 | Hold on final frame | *(measured cadence, half-beat between each)* "**Bridged. Standardized. Verifiable. Shipped.**" |

**Fallback stills:** `demo-07-judges-live.png` (full page), inset `verify-judges-13-of-13.png` (pill closeup).
**Final beat is silent — hold the frame for 1 second after "Shipped" before the recording cuts.**

---

## Cursor-motion rules

- **Never wiggle.** Move deliberately from A → B, then rest.
- **Never point at what you're not saying.** If the voiceover isn't on it, cursor isn't on it.
- **Match visual pace to voice pace.** Slow line → slow cursor. Emphatic line → cursor stops for the emphasis.

## Voice cadence rules

- **Comma = 0.3s pause.** Period = 0.7s.
- **Bolded words** = slight emphasis, not shout.
- **[SHORT PAUSE]** markers = 1s of dead air. Judges hear confidence, not desperation.
- **Chapter transitions** (0:20, 1:00, 1:45, 2:15, 2:40) = 0.5s pause between chapter end + next chapter start. Don't blend.

## Kill-list — do NOT say

so · basically · essentially · um · kind of · hypothetical · if it worked · in theory · just · actually · really · particularly · a little bit · pretty · like

## If you go over 3:00

Priority order to cut (highest first):
1. Chapter 2's "Sub-cent metering" line (-4s)
2. Chapter 4's closing standardization line (-6s)
3. Chapter 5's B2B quorum sentence (-4s)
4. Chapter 1's "SUI mainnet" mention (-3s)

Never cut: Chapter 3 (money shot). Chapter 6's closing chant.

## If you go under 2:50

Just extend the pause on "**But the same schema**" (Chapter 3 · 1:28). That line rewards deliberateness.
