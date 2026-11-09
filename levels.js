// Levels, XP and hold-time rules for FomoFish.
// XP = seconds a wallet has held (5 minutes = 300 XP). Thresholds come straight from the design table.
// Keep every number in this file: the website and the API both read from it.

const MIN = 60, HOUR = 3600, DAY = 86400;

// minXp = total hold time (in seconds, which equals XP) needed to reach the level.
// mystery = shown as "?" / "???" on the site until somebody actually reaches it.
const LEVELS = [
  { id: "plankton",   name: "Plankton",          minXp: 0 },
  { id: "shrimp",     name: "Shrimp",            minXp: 5 * MIN },
  { id: "goldfish",   name: "Goldfish",          minXp: 20 * MIN },
  { id: "starfish",   name: "Starfish",          minXp: 40 * MIN },
  { id: "seaturtle",  name: "Sea Turtle",        minXp: 80 * MIN },
  { id: "lionfish",   name: "Lion Fish",         minXp: 140 * MIN },
  { id: "jellyfish",  name: "Jelly Fish",        minXp: 220 * MIN },
  { id: "stingray",   name: "Stingray",          minXp: 6 * HOUR },
  { id: "dolphin",    name: "Dolphin",           minXp: 9 * HOUR },
  { id: "reefshark",  name: "Reef Shark",        minXp: 12 * HOUR },
  { id: "hammerhead", name: "Hammerhead Shark",  minXp: 16 * HOUR },
  { id: "tigershark", name: "Tiger Shark",       minXp: 1 * DAY },
  { id: "greatwhite", name: "Great White Shark", minXp: 36 * HOUR },
  { id: "killerwhale",name: "Killer Whale",      minXp: 60 * HOUR },
  { id: "whaleshark", name: "Whale Shark",       minXp: 4 * DAY },
  { id: "humpback",   name: "Humpback Whale",    minXp: 7 * DAY },
  { id: "megalodon",  name: "Megalodon",         minXp: 14 * DAY, mystery: "?" },
  { id: "kraken",     name: "Kraken",            minXp: 28 * DAY, mystery: "???" },
];

// Level 0 (Plankton) never earns fees. Levels 1..17 earn, each worth FEE_MULTIPLIER x the level below.
const FEE_MULTIPLIER = 1.2;

function levelIndexForXp(xp) {
  let idx = 0;
  for (let i = 0; i < LEVELS.length; i++) if (xp >= LEVELS[i].minXp) idx = i;
  return idx;
}

// XP needed to climb from level i to level i+1 (null for the top level).
function xpToNext(i) {
  return i >= LEVELS.length - 1 ? null : LEVELS[i + 1].minXp - LEVELS[i].minXp;
}

function xpOf(heldSinceMs, nowMs) {
  return Math.max(0, Math.floor((nowMs - heldSinceMs) / 1000));
}

// What a holder who sells part of their bag keeps.
//   sold >= 100%  -> leaves the reef (xp 0, no level)
//   sold >= 50%   -> drops two levels
//   sold >= 20%   -> drops one level
//   below 20%     -> loses the same fraction of their XP
function applySell(xp, soldFraction) {
  if (soldFraction <= 0) return xp;
  if (soldFraction >= 1) return null;
  const idx = levelIndexForXp(xp);
  const drop = soldFraction >= 0.5 ? 2 : soldFraction >= 0.2 ? 1 : 0;
  if (drop) return LEVELS[Math.max(0, idx - drop)].minXp;
  return Math.floor(xp * (1 - soldFraction));
}

module.exports = { LEVELS, FEE_MULTIPLIER, levelIndexForXp, xpToNext, xpOf, applySell, MIN, HOUR, DAY };
