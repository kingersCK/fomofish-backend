// Keeps holders.json fresh from the Solana chain. Needs RPC_URL (a Solana RPC endpoint, e.g. from Helius) and MINT (the token's mint address).
// Rules: buying more keeps your XP clock; selling applies the sell rule; new wallets start at zero; wallets that sold everything leave.
// Put the liquidity pool, dev and burn OWNER addresses in excludedWallets (config.json) so they never earn.
const fs = require("fs"), path = require("path");
const { applySell, xpOf } = require("./levels");
const FILE = path.join(process.env.DATA_DIR || __dirname, "holders.json");
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

// prev: [{wallet, balance, heldSince}]  cur: { wallet: balance }
function reconcile(prev, cur, nowMs) {
  const old = new Map(prev.map((h) => [h.wallet, h]));
  const out = [];
  for (const [wallet, balance] of Object.entries(cur)) {
    if (!(balance > 0)) continue;
    const p = old.get(wallet);
    if (!p) { out.push({ wallet, balance, heldSince: nowMs }); continue; }
    if (balance >= p.balance) { out.push({ wallet, balance, heldSince: p.heldSince }); continue; }
    const sold = (p.balance - balance) / p.balance;
    const xp = applySell(xpOf(p.heldSince, nowMs), sold);
    out.push({ wallet, balance, heldSince: xp == null ? nowMs : nowMs - xp * 1000 });
  }
  return out;
}

async function fetchBalances(rpc, mint) {
  const body = { jsonrpc: "2.0", id: 1, method: "getProgramAccounts", params: [TOKEN_PROGRAM, { encoding: "jsonParsed", filters: [{ dataSize: 165 }, { memcmp: { offset: 0, bytes: mint } }] }] };
  const r = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((x) => x.json());
  if (r.error) throw new Error(r.error.message);
  const cur = {};
  for (const a of r.result) { const i = a.account.data.parsed.info; cur[i.owner] = (cur[i.owner] || 0) + (i.tokenAmount.uiAmount || 0); }
  return cur;
}

async function refresh(rpc, mint) {
  const prev = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, "utf8")) : [];
  const next = reconcile(prev, await fetchBalances(rpc, mint), Date.now());
  fs.writeFileSync(FILE + ".tmp", JSON.stringify(next));
  fs.renameSync(FILE + ".tmp", FILE);
  return next.length;
}

module.exports = { reconcile, fetchBalances, refresh };

if (require.main === module) {
  const { RPC_URL, MINT } = process.env;
  if (!RPC_URL || !MINT) { console.error("Set RPC_URL and MINT"); process.exit(1); }
  const go = () => refresh(RPC_URL, MINT).then((n) => console.log("holders:", n), (e) => console.error("indexer", e.message));
  go(); setInterval(go, 60000);
}
