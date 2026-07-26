// A single-tenant password gate.
//
// This station holds whatever you send it — meeting recordings included — so a
// public URL without a lock on it would publish your work to anyone who guesses
// the hostname. It would also let strangers spend your Anthropic credits.
//
// One shared password, an HMAC-signed cookie, no user accounts. That matches
// what the product is: your station, not a service.

const COOKIE = "immerse_session";
const TTL_SECONDS = 60 * 60 * 24 * 30;

const enc = new TextEncoder();

function bytesToHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return bytesToHex(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
}

// Comparison that doesn't leak how much of the value matched via timing.
function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function issueCookie(env) {
  const expires = Date.now() + TTL_SECONDS * 1000;
  const sig = await hmac(env.SESSION_SECRET, String(expires));
  const value = `${expires}.${sig}`;
  return `${COOKIE}=${value}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${TTL_SECONDS}`;
}

export function clearCookie() {
  return `${COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}

function readCookie(request) {
  const header = request.headers.get("Cookie") || "";
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === COOKIE) return rest.join("=");
  }
  return null;
}

export async function isAuthed(request, env) {
  // Refuse to run unlocked. A missing password would otherwise silently mean
  // "open to everyone", which is the exact failure this module exists to stop.
  if (!env.ACCESS_PASSWORD || !env.SESSION_SECRET) return false;

  const raw = readCookie(request);
  if (!raw) return false;

  const [expires, sig] = raw.split(".");
  if (!expires || !sig) return false;
  if (Number(expires) < Date.now()) return false;

  return safeEqual(sig, await hmac(env.SESSION_SECRET, expires));
}

export async function checkPassword(env, submitted) {
  if (!env.ACCESS_PASSWORD) return false;
  // Hash both sides first so the comparison is over fixed-length strings.
  const [a, b] = await Promise.all([
    hmac(env.SESSION_SECRET || "x", String(submitted ?? "")),
    hmac(env.SESSION_SECRET || "x", env.ACCESS_PASSWORD),
  ]);
  return safeEqual(a, b);
}

export function configured(env) {
  return Boolean(env.ACCESS_PASSWORD && env.SESSION_SECRET);
}
