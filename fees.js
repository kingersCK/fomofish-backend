// Fee shares per level and hourly allocation.
//
// Rule: each earning level weighs FEE_MULTIPLIER x the level below it (Plankton weighs 0).
// A level's share = its weight / total weight of the levels that currently have at least one holder.
// Empty levels get nothing and their share is spread over the occupied levels, so shares always sum to 100%.

const { LEVELS, FEE_MULTIPLIER } = require("./levels");

const N = LEVELS.length;

function weight(i) {
  return i === 0 ? 0 : Math.pow(FEE_MULTIPLIER, i - 1);
}

// occupied: Set (or array) of level indexes that have holders.
// Returns an array of N fractions that sum to 1, or all zeros if no earning level is occupied.
function feeShares(occupied) {
  const occ = new Set(occupied);
  let total = 0;
  for (let i = 1; i < N; i++) if (occ.has(i)) total += weight(i);
  return Array.from({ length: N }, (_, i) => (i > 0 && occ.has(i) && total > 0 ? weight(i) / total : 0));
}

// Splits a pool (integer lamports) across holders. A level's share is divided between its holders by token balance.
// holders: [{ wallet, level, balance }]   Returns { payouts: {wallet: lamports}, distributed, rolledOver, shares }
// Uses largest-remainder rounding so the payouts add up to exactly the pool (or the pool rolls over if nobody earns).
function allocate(poolLamports, holders) {
  const earners = holders.filter((h) => h.level > 0 && h.balance > 0);
  const shares = feeShares(earners.map((h) => h.level));
  const payouts = {};
  if (earners.length === 0 || shares.every((s) => s === 0)) {
    return { payouts, distributed: 0, rolledOver: poolLamports, shares };
  }
  const byLevel = new Map();
  for (const h of earners) {
    if (!byLevel.has(h.level)) byLevel.set(h.level, []);
    byLevel.get(h.level).push(h);
  }
  const exact = []; // {wallet, value}
  for (const [lvl, list] of byLevel) {
    const levelPool = poolLamports * shares[lvl];
    const bal = list.reduce((s, h) => s + h.balance, 0);
    for (const h of list) exact.push({ wallet: h.wallet, value: levelPool * (h.balance / bal) });
  }
  let given = 0;
  const rows = exact.map((e) => {
    const base = Math.floor(e.value);
    given += base;
    return { wallet: e.wallet, base, frac: e.value - base };
  });
  let left = poolLamports - given;
  rows.sort((a, b) => b.frac - a.frac);
  for (let k = 0; left > 0 && k < rows.length; k++, left--) rows[k].base += 1;
  for (const r of rows) payouts[r.wallet] = (payouts[r.wallet] || 0) + r.base;
  return { payouts, distributed: poolLamports, rolledOver: 0, shares };
}

module.exports = { weight, feeShares, allocate };
