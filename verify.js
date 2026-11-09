// Wallet ownership proof for withdrawals: the wallet signs a one-time message (ed25519, as Solana wallets do).
const crypto = require("crypto");
const ALPHA = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function b58decode(s) {
  let n = 0n;
  for (const c of s) { const i = ALPHA.indexOf(c); if (i < 0) throw new Error("bad base58"); n = n * 58n + BigInt(i); }
  let hex = n.toString(16); if (hex.length % 2) hex = "0" + hex;
  const body = n === 0n ? Buffer.alloc(0) : Buffer.from(hex, "hex");
  let zeros = 0; for (const c of s) { if (c === "1") zeros++; else break; }
  return Buffer.concat([Buffer.alloc(zeros), body]);
}
function b58encode(buf) {
  let n = BigInt("0x" + (buf.toString("hex") || "0")), out = "";
  while (n > 0n) { out = ALPHA[Number(n % 58n)] + out; n /= 58n; }
  for (const b of buf) { if (b === 0) out = "1" + out; else break; }
  return out;
}
const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

// wallet: base58 public key. signature: base64. message: the exact string that was signed.
function verifySignature(wallet, message, signatureB64) {
  try {
    const pub = b58decode(wallet);
    if (pub.length !== 32) return false;
    const key = crypto.createPublicKey({ key: Buffer.concat([SPKI_PREFIX, pub]), format: "der", type: "spki" });
    return crypto.verify(null, Buffer.from(message, "utf8"), key, Buffer.from(signatureB64, "base64"));
  } catch { return false; }
}

const challenge = (brand, wallet, nonce, exp) => `${brand} withdrawal\nWallet: ${wallet}\nNonce: ${nonce}\nExpires: ${exp}`;

module.exports = { verifySignature, challenge, b58decode, b58encode };
