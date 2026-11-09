# FomoFish backend

Plain Node (18+), no dependencies. `node test.js` runs the tests, `node server.js` starts the API.

## Setup
1. Copy `config.example.json` to `config.json` and fill in `adminToken`, `solUsd` and `excludedWallets` (dev, liquidity pool, burn).
2. Keep `holders.json` fresh from your indexer: `[{ "wallet": "...", "balance": 123, "heldSince": 1760000000000 }]`.
3. Run the hourly settlement at the top of each hour: `POST /api/settle` with header `x-admin-token` and body `{ "feePoolLamports": <fees collected that hour> }`.

## Endpoints
- `GET /api/fees` fee table (name, hold time, XP to next, holders, live fee %). Megalodon and Kraken show `?` and `???` until someone reaches them.
- `GET /api/wallet/:address` passed levels (XP required and fee %), current level (XP progress), next 3 levels (fee % only), earned and pending SOL.
- `GET /api/leaderboard`, `GET /api/next-settlement`, `POST /api/withdraw {wallet}` ($2 minimum), `POST /api/settle` (admin).

## The formula
XP is seconds held. Each earning level weighs 1.2x the one below it (Shrimp = 1, Goldfish = 1.2, ... Kraken = 1.2^16). Plankton weighs 0. A level's fee share = its weight divided by the total weight of the levels that currently have holders, so shares always add up to 100% and empty levels are redistributed. With every level occupied the shares are the published 0 / 0.94 / 1.13 ... 17.45%.

Fees settle at the top of each hour. Someone who buys at minute 59 is still Plankton and earns nothing.

Sells: sold 100% leaves; 50% or more drops 2 levels; 20% or more drops 1; under 20% loses that fraction of XP.

## Assumptions to confirm
- Inside a level the pool is split by token balance (so splitting a bag across many wallets gains nothing). Say if you want an equal split per wallet instead.
- 1.2x puts about 32% of the pool in the top two levels.
- This is a ledger only. No SOL moves. `withdraw` just zeroes the pending balance.

## Before real money moves
- A treasury wallet and an audited payout program/process.
- Wallet ownership check on withdraw (signed message), live SOL price feed, an indexer that tracks balances and `heldSince`.
- Legal advice for the UK (and anywhere you market to). Fee sharing to holders can attract regulation.

## Telegram bot
`BOT_TOKEN=... CHAT_ID=... API=http://localhost:8787 node bot.js` (token from BotFather, never commit it).
Commands: /fish, /top, /next, /levels. Level-up shout-outs only fire the first time anyone ever reaches a level.
