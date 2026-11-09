// Brand name API. Run: node server.js   (needs Node 18+, no dependencies)
//
//   GET  /api/fees               public fee table (who is at each level, fee % per level)
//   GET  /api/wallet/:address    one wallet's view: passed / current / next 3 levels, earnings
//   GET  /api/leaderboard        top earners
//   GET  /api/next-settlement    when fees are next paid (top of the hour)
//   POST /api/withdraw           {wallet}  pays out pending fees if they are worth at least $2 (ledger only for now)
//   POST /api/settle             admin only: run the hourly settlement now (header x-admin-token)
//
// Holders come from holders.json: [{ "wallet": "...", "balance": 12345, "heldSince": 1760000000000 }, ...]
// An indexer should keep that file fresh and leave out the dev, liquidity pool and burn wallets.

const http = require("http");
const fs = require("fs");
const path = require("path");
const { walletView, feeTable } = require("./view");
const { settleHour, withdraw, nextSettlementMs, LAMPORTS_PER_SOL } = require("./settlement");
const crypto = require("crypto");
const { verifySignature, challenge } = require("./verify");


const cfgPath = path.join(__dirname, "config.json");
const cfg = fs.existsSync(cfgPath) ? JSON.parse(fs.readFileSync(cfgPath, "utf8")) : {};
const PORT = process.env.PORT || cfg.port || 8787;
const BRAND = process.env.BRAND || cfg.brand || "FomoFish";
const EXCLUDED = new Set(cfg.excludedWallets || []);
const SOL_USD = cfg.solUsd || 150; // replace with a live price feed
const DATA = process.env.DATA_DIR || __dirname; // point DATA_DIR at a Railway Volume (e.g. /data) so state survives redeploys
const STATE_FILE = path.join(DATA, "state.json");
const HOLDERS_FILE = path.join(DATA, "holders.json");

const readJson = (f, d) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : d);
const loadState = () => readJson(STATE_FILE, { ledger: {}, rollover: 0, history: [] });
const saveState = (s) => fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
const loadHolders = () => readJson(HOLDERS_FILE, []).filter((h) => !EXCLUDED.has(h.wallet));

function send(res, code, body) {
  res.writeHead(code, { "content-type": "application/json", "access-control-allow-origin": "*" });
  res.end(JSON.stringify(body));
}
function readBody(req) {
  return new Promise((ok) => {
    let d = "";
    req.on("data", (c) => (d += c));
    req.on("end", () => { try { ok(JSON.parse(d || "{}")); } catch { ok({}); } });
  });
}

http.createServer(async (req, res) => {
  const now = Date.now();
  const url = new URL(req.url, "http://x");
  try {
    if (req.method === "OPTIONS") return send(res, 204, {});
    if (url.pathname === "/api/fees") return send(res, 200, { solUsd: SOL_USD, table: feeTable(loadHolders(), now) });
    if (url.pathname.startsWith("/api/wallet/")) {
      const wallet = decodeURIComponent(url.pathname.split("/")[3] || "");
      const v = walletView({ wallet, holders: loadHolders(), nowMs: now, ledger: loadState().ledger, solUsd: SOL_USD });
      return send(res, v.found ? 200 : 404, v);
    }
    if (url.pathname === "/api/leaderboard") {
      const rows = Object.entries(loadState().ledger).map(([wallet, r]) => ({ wallet, totalSol: r.total / LAMPORTS_PER_SOL }));
      rows.sort((a, b) => b.totalSol - a.totalSol);
      return send(res, 200, rows.slice(0, 25));
    }
    if (url.pathname === "/api/last-payout") {
      const h = (loadState().history || []).slice(-1)[0] || null;
      return send(res, 200, h);
    }
    if (url.pathname === "/api/next-settlement") return send(res, 200, { at: nextSettlementMs(now), inMs: nextSettlementMs(now) - now });
    if (url.pathname === "/api/config") return send(res, 200, { brand: BRAND });
    if (url.pathname.startsWith("/api/nonce/")) {
      // Step 1 of a withdrawal: get a one-time message for this wallet to sign.
      const wallet = decodeURIComponent(url.pathname.split("/")[3] || "");
      const state = loadState();
      const nonce = crypto.randomBytes(16).toString("hex"), exp = now + 5 * 60 * 1000;
      state.nonces = state.nonces || {};
      state.nonces[wallet] = { nonce, exp };
      saveState(state);
      return send(res, 200, { message: challenge(BRAND, wallet, nonce, exp), exp });
    }
    if (url.pathname === "/api/withdraw" && req.method === "POST") {
      // Step 2: send { wallet, signature (base64 of the signed message) }. Pending fees move to a payout request.
      const { wallet, signature } = await readBody(req);
      const state = loadState();
      const n = state.nonces && state.nonces[wallet];
      if (!n || n.exp < now) return send(res, 400, { ok: false, reason: "Ask for a new message to sign" });
      if (!verifySignature(wallet, challenge(BRAND, wallet, n.nonce, n.exp), signature || "")) return send(res, 403, { ok: false, reason: "Signature does not match this wallet" });
      delete state.nonces[wallet]; // one use only
      const out = withdraw(state, wallet, SOL_USD);
      if (out.ok) {
        state.payouts = state.payouts || [];
        state.payouts.push({ id: crypto.randomBytes(6).toString("hex"), wallet, lamports: out.lamports, at: now, status: "requested" });
      }
      saveState(state);
      return send(res, out.ok ? 200 : 400, out);
    }
    if (url.pathname === "/api/admin/payouts") {
      if (!cfg.adminToken || req.headers["x-admin-token"] !== cfg.adminToken) return send(res, 403, { error: "forbidden" });
      if (req.method === "POST") { // mark one as sent: { id, txid }
        const { id, txid } = await readBody(req);
        const state = loadState(), p = (state.payouts || []).find((x) => x.id === id);
        if (!p) return send(res, 404, { error: "unknown payout" });
        p.status = "paid"; p.txid = txid || ""; saveState(state);
        return send(res, 200, p);
      }
      return send(res, 200, (loadState().payouts || []).filter((p) => p.status === "requested"));
    }
    if (url.pathname === "/api/settle" && req.method === "POST") {
      if (!cfg.adminToken || req.headers["x-admin-token"] !== cfg.adminToken) return send(res, 403, { error: "forbidden" });
      const { feePoolLamports = 0 } = await readBody(req);
      const state = loadState();
      const entry = settleHour(state, loadHolders(), feePoolLamports, now);
      saveState(state);
      return send(res, 200, entry);
    }
    send(res, 404, { error: "not found" });
  } catch (e) {
    send(res, 500, { error: String(e.message || e) });
  }
}).listen(PORT, () => console.log(`${BRAND} API on :${PORT}`));
