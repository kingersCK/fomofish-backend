// Hourly settlement and withdrawals (ledger only: this does not move real SOL).
//
// Fees are settled at the top of every hour, so a wallet that buys in at minute 59 has no XP and earns
// nothing (Plankton earns 0%). Levels are measured at the moment of settlement.
//
// Real payouts need a treasury wallet and an audited payout program. Until then this keeps the books
// so the website and API can be built and tested against realistic numbers.

const { levelIndexForXp, xpOf } = require("./levels");
const { allocate } = require("./fees");

const LAMPORTS_PER_SOL = 1_000_000_000;
const MIN_WITHDRAW_USD = 2;

function nextSettlementMs(nowMs) {
  const h = 3600 * 1000;
  return Math.floor(nowMs / h) * h + h;
}

// state: { ledger: { [wallet]: { pending, total } }, rollover, history: [] }
// holders: [{ wallet, balance, heldSince(ms) }]  (excluded wallets must already be removed)
function settleHour(state, holders, feePoolLamports, nowMs) {
  const withLevels = holders.map((h) => ({
    wallet: h.wallet,
    balance: h.balance,
    level: levelIndexForXp(xpOf(h.heldSince, nowMs)),
  }));
  const pool = feePoolLamports + (state.rollover || 0);
  const res = allocate(pool, withLevels);
  for (const [wallet, lamports] of Object.entries(res.payouts)) {
    const row = state.ledger[wallet] || (state.ledger[wallet] = { pending: 0, total: 0 });
    row.pending += lamports;
    row.total += lamports;
  }
  state.rollover = res.rolledOver;
  const entry = { at: nowMs, pool, distributed: res.distributed, rolledOver: res.rolledOver, shares: res.shares };
  (state.history || (state.history = [])).push(entry);
  return entry;
}

// Real version: require a signed message from the wallet before paying out.
function withdraw(state, wallet, solUsd) {
  const row = state.ledger[wallet];
  const sol = row ? row.pending / LAMPORTS_PER_SOL : 0;
  const usd = sol * solUsd;
  if (!row || usd < MIN_WITHDRAW_USD) {
    return { ok: false, reason: `Minimum withdrawal is $${MIN_WITHDRAW_USD}`, pendingUsd: usd };
  }
  const paid = row.pending;
  row.pending = 0;
  return { ok: true, lamports: paid, sol: paid / LAMPORTS_PER_SOL, usd };
}

module.exports = { settleHour, withdraw, nextSettlementMs, LAMPORTS_PER_SOL, MIN_WITHDRAW_USD };
