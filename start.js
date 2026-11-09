// Starts the API and the Telegram bot together (one process for simple hosting).
const { spawn } = require("child_process");
const run = (f) => { const p = spawn(process.execPath, [f], { stdio: "inherit", env: process.env }); p.on("exit", (c) => { console.error(f, "exited", c); process.exit(c || 1); }); };
run("server.js");
if (process.env.BOT_TOKEN) setTimeout(() => run("bot.js"), 1000); else console.log("BOT_TOKEN not set: API only");
