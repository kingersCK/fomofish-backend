// FomoFish Telegram bot. Node 18+, no dependencies.
//   BOT_TOKEN=123:abc  CHAT_ID=-100123...  API=http://localhost:8787  node bot.js
// Commands: /fish <wallet>  /top  /next  /levels
// Announcements (to CHAT_ID):
//   - a level-up shout-out ONLY when a level is reached for the first time ever (no spam)
//   - a short post after each hourly payout
const TOKEN = process.env.BOT_TOKEN, CHAT = process.env.CHAT_ID, API = process.env.API || "http://localhost:8787";
const fs = require("fs"), path = require("path");
if (!TOKEN) { console.error("Set BOT_TOKEN (from BotFather)"); process.exit(1); }
const TG = `https://api.telegram.org/bot${TOKEN}`;
const FILE = path.join(__dirname, "bot-state.json");
const st = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, "utf8")) : { reached: null, lastPayoutAt: 0, offset: 0 };
const save = () => fs.writeFileSync(FILE, JSON.stringify(st));
const tg = (m, b) => fetch(`${TG}/${m}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }).then((r) => r.json());
const say = (chat, text) => tg("sendMessage", { chat_id: chat, text, parse_mode: "HTML", disable_web_page_preview: true });
const api = (p) => fetch(API + p).then((r) => r.json());
const short = (w) => w.slice(0, 4) + "…" + w.slice(-4);
const num = (n) => Number(n).toFixed(3);

async function onCommand(chat, text) {
  const [cmd, arg] = text.trim().split(/\s+/);
  const c = cmd.split("@")[0].toLowerCase();
  if (c === "/start" || c === "/help") return say(chat, "🐟 <b>FomoFish</b>\n/fish &lt;wallet&gt; find your sea creature\n/top top earners\n/next time to the next payout\n/levels the fee table");
  if (c === "/fish") {
    if (!arg) return say(chat, "Send /fish followed by your wallet address.");
    const v = await api("/api/wallet/" + encodeURIComponent(arg));
    if (!v.found) return say(chat, "I can't find that wallet among the holders.");
    const nx = v.next.map((n) => `${n.name} ${n.feePct}%`).join(" · ");
    return say(chat, `<b>${v.current.name}</b> · ${v.current.feePct}% of hourly fees\nXP: ${v.current.xp.toLocaleString()}${v.current.xpNeeded ? " (" + Math.round(v.current.progress * 100) + "% to next level)" : ""}\nNext: ${nx}\nEarned: ${num(v.earned.totalSol)} SOL · Pending: ${num(v.earned.pendingSol)} SOL`);
  }
  if (c === "/top") {
    const rows = await api("/api/leaderboard");
    return say(chat, rows.length ? "<b>Top earners</b>\n" + rows.slice(0, 5).map((r, i) => `${i + 1}. ${short(r.wallet)} · ${num(r.totalSol)} SOL`).join("\n") : "No payouts yet.");
  }
  if (c === "/next") {
    const n = await api("/api/next-settlement"), m = Math.ceil(n.inMs / 60000);
    return say(chat, `Next payout in about ${m} minute${m === 1 ? "" : "s"}.`);
  }
  if (c === "/levels") {
    const f = await api("/api/fees");
    return say(chat, "<b>Fee table</b>\n" + f.table.map((r) => `${r.name}: ${r.feePct}%${r.holders ? "" : " (empty)"}`).join("\n"));
  }
}

async function poll() {
  try {
    const r = await tg("getUpdates", { offset: st.offset, timeout: 25 });
    for (const u of r.result || []) {
      st.offset = u.update_id + 1;
      const m = u.message;
      if (m && m.text && m.text.startsWith("/")) await onCommand(m.chat.id, m.text).catch((e) => console.error(e));
    }
    save();
  } catch (e) { console.error("poll", e.message); await new Promise((r) => setTimeout(r, 5000)); }
  setImmediate(poll);
}

async function watch() {
  if (!CHAT) return;
  try {
    const f = await api("/api/fees");
    const now = f.table.filter((r) => r.holders > 0).map((r) => r.level);
    if (st.reached === null) st.reached = now; // first run: record, do not announce
    else {
      for (const r of f.table) {
        if (r.holders > 0 && !st.reached.includes(r.level)) {
          st.reached.push(r.level);
          await say(CHAT, `🌊 <b>New species discovered!</b> Someone just became a <b>${r.name}</b>, the first ever to reach this level. It pays ${r.feePct}% of hourly fees.`);
        }
      }
    }
    const p = await api("/api/last-payout");
    if (p && p.at > st.lastPayoutAt) {
      if (st.lastPayoutAt) await say(CHAT, `⏰ Hourly payout done: ${num(p.distributed / 1e9)} SOL shared with holders. Fees are paid in SOL.`);
      st.lastPayoutAt = p.at;
    }
    save();
  } catch (e) { console.error("watch", e.message); }
}
setInterval(watch, 60000); watch(); poll();
console.log("FomoFish bot running");
