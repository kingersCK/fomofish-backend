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

## Switching the name
Set `BRAND=FomoFishy` in Railway Variables and redeploy: the bot and API use it. On the website change the `NAME` constant at the top of its script.

## Live holder feed (indexer)
Set `RPC_URL` (a Solana RPC, e.g. Helius) and `MINT` (the token mint address) and `npm start` also runs `indexer.js`, which rewrites `holders.json` every minute. Buys keep a wallet's XP, sells apply the sell rule, new wallets start at zero. Put the liquidity pool, dev and burn OWNER addresses in `config.json` under `excludedWallets`. Assumes the standard SPL token program (Token-2022 mints need a small change).

## Withdrawals (wallet-signed)
1. `GET /api/nonce/:wallet` returns a message to sign (valid 5 minutes, one use).
2. The wallet signs it (Phantom `signMessage`); `POST /api/withdraw {wallet, signature}` with the signature in base64.
3. If valid and at least $2 is pending, the amount becomes a payout request. `GET /api/admin/payouts` (header `x-admin-token`) lists requests; after you send the SOL, `POST /api/admin/payouts {id, txid}` marks it paid.
This server never holds a private key. Send payouts from your own wallet or a proper signer, not from this server.

## Storage warning
`state.json` and `holders.json` live on the container's disk, which Railway wipes on every redeploy. Before launch add a Railway Volume mounted at the app folder (or move state to a database).

## Railway Volume
Create a Volume mounted at `/data` and set `DATA_DIR=/data` in Variables. state.json, holders.json and bot-state.json are then stored there and survive redeploys.
