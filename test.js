// Run: node test.js
const assert = require("assert");
const { LEVELS, levelIndexForXp, xpToNext, applySell, HOUR, DAY } = require("./levels");
const { feeShares, allocate } = require("./fees");
const { settleHour, withdraw, nextSettlementMs } = require("./settlement");
const { walletView, feeTable } = require("./view");

// 1) XP table matches the design table (XP till next level, in seconds)
const expectedNext = [300, 900, 1200, 2400, 3600, 4800, 8400, 10800, 10800, 14400, 28800, 43200, 86400, 129600, 259200, 604800, 1209600];
expectedNext.forEach((x, i) => assert.strictEqual(xpToNext(i), x, `xp to next for level ${i}`));
assert.strictEqual(xpToNext(17), null);
assert.strictEqual(LEVELS.length, 18);
assert.strictEqual(levelIndexForXp(0), 0);
assert.strictEqual(levelIndexForXp(299), 0);
assert.strictEqual(levelIndexForXp(300), 1);
assert.strictEqual(levelIndexForXp(28 * DAY), 17);

// 2) Fee table with every level occupied matches the published percentages
const all = feeShares(Array.from({ length: 17 }, (_, i) => i + 1));
const published = [0, 0.94, 1.13, 1.36, 1.63, 1.96, 2.35, 2.82, 3.38, 4.06, 4.87, 5.85, 7.01, 8.42, 10.1, 12.12, 14.54, 17.45];
published.forEach((p, i) => assert.strictEqual(Math.round(all[i] * 10000) / 100, p, `fee % level ${i}`));

// 3) Every possible set of occupied levels sums to exactly 100% (all 2^17 combinations)
let checked = 0;
for (let mask = 1; mask < 1 << 17; mask++) {
  const occ = [];
  for (let b = 0; b < 17; b++) if (mask & (1 << b)) occ.push(b + 1);
  const s = feeShares(occ);
  const sum = s.reduce((a, b) => a + b, 0);
  assert(Math.abs(sum - 1) < 1e-12, `mask ${mask} sums to ${sum}`);
  assert.strictEqual(s[0], 0);
  checked++;
}
assert.strictEqual(feeShares([]).reduce((a, b) => a + b, 0), 0); // nobody earning -> nothing to split

// 4) Redistribution: with only levels 1 and 2 occupied, 45.45% / 54.55%
const two = feeShares([1, 2]);
assert.strictEqual(Math.round(two[1] * 10000) / 100, 45.45);
assert.strictEqual(Math.round(two[2] * 10000) / 100, 54.55);

// 5) Allocation adds up to the pool exactly and splits a level by balance
const holders = [
  { wallet: "A", level: 1, balance: 100 },
  { wallet: "B", level: 2, balance: 300 },
  { wallet: "C", level: 2, balance: 100 },
  { wallet: "P", level: 0, balance: 999999 }, // plankton earns nothing
];
const r = allocate(1_000_000_001, holders);
assert.strictEqual(Object.values(r.payouts).reduce((a, b) => a + b, 0), 1_000_000_001);
assert.strictEqual(r.payouts.P, undefined);
assert(r.payouts.B > r.payouts.C * 2.9 && r.payouts.B < r.payouts.C * 3.1);
const none = allocate(500, [{ wallet: "P", level: 0, balance: 5 }]);
assert.strictEqual(none.rolledOver, 500);

// 6) Sell rule
assert.strictEqual(applySell(7 * DAY, 1), null);
assert.strictEqual(levelIndexForXp(applySell(7 * DAY, 0.5)), 13); // Humpback (15) drops two levels -> Killer Whale (13)
assert.strictEqual(levelIndexForXp(applySell(7 * DAY, 0.25)), 14); // drops one -> Whale Shark
assert.strictEqual(applySell(1000, 0.1), 900);

// 7) Hourly settlement + the $2 withdrawal minimum
assert.strictEqual(nextSettlementMs(Date.UTC(2026, 0, 1, 10, 30)), Date.UTC(2026, 0, 1, 11, 0));
const now = Date.UTC(2026, 10, 8, 12, 0, 0);
const hs = [
  { wallet: "A", balance: 100, heldSince: now - 6 * HOUR * 1000 },   // Stingray (7)
  { wallet: "B", balance: 100, heldSince: now - 2 * DAY * 1000 },    // Great White (12)
  { wallet: "S", balance: 100, heldSince: now - 30 * 1000 },  // sniper: Plankton
];
const state = { ledger: {}, rollover: 0, history: [] };
const e = settleHour(state, hs, 2_000_000_000, now);
assert.strictEqual(e.distributed, 2_000_000_000);
assert.strictEqual(state.ledger.S, undefined, "a fresh buyer earns nothing");
assert(state.ledger.B.pending > state.ledger.A.pending);
assert.strictEqual(state.ledger.A.pending + state.ledger.B.pending, 2_000_000_000);
const w1 = withdraw(state, "A", 1); // at $1/SOL the pending amount is far below $2
assert.strictEqual(w1.ok, false);
const w2 = withdraw(state, "B", 150);
assert.strictEqual(w2.ok, true);
assert.strictEqual(state.ledger.B.pending, 0);
assert(state.ledger.B.total > 0, "lifetime total is kept after a withdrawal");

// 8) Wallet view: passed levels show XP, next 3 hide XP, mystery levels stay hidden
const view = walletView({ wallet: "B", holders: hs, nowMs: now, ledger: state.ledger, solUsd: 150 });
assert.strictEqual(view.current.name, "Great White Shark");
assert.strictEqual(view.passed.length, 12);
assert.strictEqual(view.passed[0].xpRequired, 300);
assert.strictEqual(view.next.length, 3);
assert(view.next.every((n) => n.xpRequired === undefined));
const lastView = walletView({ wallet: "B", holders: [{ wallet: "B", balance: 1, heldSince: now - 15 * DAY * 1000 }], nowMs: now, ledger: {}, solUsd: 150 });
assert.strictEqual(lastView.current.name, "Megalodon"); // whoever reaches it sees the name
assert.strictEqual(lastView.next[0].name, "???");
const tbl = feeTable(hs, now);
assert.strictEqual(tbl[16].name, "?");
assert.strictEqual(tbl[17].name, "???");

console.log(`all tests passed (${checked} occupancy combinations checked)`);
