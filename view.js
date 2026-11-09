// Builds exactly what the website shows for one wallet.
//   passed   - levels the wallet has left behind: name, XP it took, fee % that level pays
//   current  - level, XP held, XP needed to reach the next level, progress
//   next     - the next 3 levels: name and fee % only (their XP requirements stay hidden)
// Names of the mystery levels stay as "?" / "???" until someone reaches them (reached = set of level indexes).

const { LEVELS, levelIndexForXp, xpToNext, xpOf } = require("./levels");
const { feeShares } = require("./fees");

function label(i, reached) {
  const L = LEVELS[i];
  return L.mystery && !reached.has(i) ? L.mystery : L.name;
}

function pct(x) {
  return Math.round(x * 10000) / 100; // 2 decimals
}

function walletView({ wallet, holders, nowMs, ledger, solUsd }) {
  const levels = holders.map((h) => ({ ...h, xp: xpOf(h.heldSince, nowMs) }));
  levels.forEach((h) => (h.level = levelIndexForXp(h.xp)));
  const reached = new Set(levels.map((h) => h.level));
  const shares = feeShares(levels.filter((h) => h.level > 0).map((h) => h.level));
  const me = levels.find((h) => h.wallet === wallet);
  if (!me) return { found: false };
  const i = me.level;
  const passed = [];
  for (let k = 0; k < i; k++) passed.push({ level: k, name: label(k, reached), xpRequired: xpToNext(k), feePct: pct(shares[k]) });
  const next = [];
  for (let k = i + 1; k <= Math.min(i + 3, LEVELS.length - 1); k++) next.push({ level: k, name: label(k, reached), feePct: pct(shares[k]) });
  const need = xpToNext(i);
  const row = (ledger && ledger[wallet]) || { pending: 0, total: 0 };
  return {
    found: true,
    wallet,
    balance: me.balance,
    current: { level: i, name: label(i, reached), xp: me.xp, xpNeeded: need, progress: need ? Math.min(1, (me.xp - LEVELS[i].minXp) / need) : 1, feePct: pct(shares[i]) },
    passed,
    next,
    earned: { totalSol: row.total / 1e9, pendingSol: row.pending / 1e9, pendingUsd: (row.pending / 1e9) * solUsd },
  };
}

// The public fee table. Mystery levels show as "?" and "???" until someone reaches them.
function feeTable(holders, nowMs) {
  const levels = holders.map((h) => levelIndexForXp(xpOf(h.heldSince, nowMs)));
  const reached = new Set(levels);
  const shares = feeShares(levels.filter((l) => l > 0));
  const counts = new Array(LEVELS.length).fill(0);
  levels.forEach((l) => counts[l]++);
  return LEVELS.map((L, i) => ({
    level: i,
    name: label(i, reached),
    totalHoldSeconds: L.minXp,
    xpToNext: xpToNext(i),
    holders: counts[i],
    feePct: pct(shares[i]),
  }));
}

module.exports = { walletView, feeTable };
