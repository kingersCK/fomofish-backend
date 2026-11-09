// FomoFish API. Run: node server.js   (needs Node 18+, no dependencies)
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

const cfgPath = path.join(__dirname, "config.json");
const cfg = fs.existsSync(cfgPath) ? JSON.parse(fs.readFileSync(cfgPath, "utf8")) : {};
const PORT = process.env.PORT || cfg.port || 8787;
const EXCLUDED = new Set(cfg.excludedWallets || []);
const SOL_USD = cfg.solUsd || 150; // replace with a live price feed
const STATE_FILE = path.join(__dirname, "state.json");
const HOLDERS_FILE = path.join(__dirname, "holders.json");

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
    if (url.pathname === "/api/withdraw" && req.method === "POST") {
      const { wallet } = await readBody(req); // real version: verify a signed message from this wallet
      const state = loadState();
      const out = withdraw(state, wallet, SOL_USD);
      if (out.ok) saveState(state);
      return send(res, out.ok ? 200 : 400, out);
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
}).listen(PORT, () => console.log(`FomoFish API on :${PORT}`));
