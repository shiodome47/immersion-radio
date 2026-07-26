// A single-tenant password gate.
//
// This station holds whatever you send it — meeting recordings included — so a
// public URL without a lock on it would publish your work to anyone who guesses
// the hostname. It would also let strangers spend your Anthropic credits.
//
// One shared password, an HMAC-signed cookie, no user accounts. That matches
// what the product is: your station, not a service.
//
// Nothing here needs configuring before the station is usable. The first
// visitor chooses the password and it is stored (hashed) in the Durable Object;
// the cookie-signing key the station generates for itself. Requiring a dashboard
// visit to set either one just meant a freshly deployed station could not be
// opened by the person who deployed it.
//
// ACCESS_PASSWORD still works as an override: set it and it wins, and first-run
// setup is closed off.

const COOKIE = "immerse_session";
const TTL_SECONDS = 60 * 60 * 24 * 30;

// Normalises both sides of a comparison to a fixed length. Not a secret — it
// never leaves this comparison.
const COMPARE_KEY = "immerse-fm/password-compare";

const enc = new TextEncoder();

function bytesToHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmac(key, message) {
  const imported = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return bytesToHex(await crypto.subtle.sign("HMAC", imported, enc.encode(message)));
}

// Comparison that doesn't leak how much of the value matched via timing.
function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Lax rather than Strict. Strict withholds the cookie on any cross-site
// navigation, so arriving from a link — the Cloudflare dashboard's own "Visit"
// button, a bookmark shared to yourself, a chat message — lands you on the lock
// screen while the session is perfectly valid. Lax still withholds it from
// cross-site POSTs, which is the CSRF vector that matters here: every route
// that changes anything is POST, PUT or DELETE.
const COOKIE_ATTRS = `HttpOnly; Secure; SameSite=Lax; Path=/`;

export async function issueCookie(secret) {
  const expires = Date.now() + TTL_SECONDS * 1000;
  const sig = await hmac(secret, String(expires));
  return `${COOKIE}=${expires}.${sig}; ${COOKIE_ATTRS}; Max-Age=${TTL_SECONDS}`;
}

export function clearCookie() {
  return `${COOKIE}=; ${COOKIE_ATTRS}; Max-Age=0`;
}

function readCookie(request) {
  const header = request.headers.get("Cookie") || "";
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === COOKIE) return rest.join("=");
  }
  return null;
}

// The station is locked once a password exists, whichever way it was set.
export const hasPassword = (env, storedHash) => Boolean(env.ACCESS_PASSWORD || storedHash);

// Never store the password itself — only something we can compare against.
export const hashPassword = (secret, password) => hmac(secret, String(password));

export async function isAuthed(request, { env, secret, storedHash }) {
  // Fail closed. With no password at all the station is mid-setup, and an
  // unsigned visitor must not be treated as the owner.
  if (!hasPassword(env, storedHash) || !secret) return false;

  const raw = readCookie(request);
  if (!raw) return false;

  const [expires, sig] = raw.split(".");
  if (!expires || !sig) return false;
  if (Number(expires) < Date.now()) return false;

  return safeEqual(sig, await hmac(secret, expires));
}

export async function verifyPassword({ env, secret, storedHash, submitted }) {
  const candidate = String(submitted ?? "");
  if (!candidate) return false;

  if (env.ACCESS_PASSWORD) {
    const [a, b] = await Promise.all([
      hmac(COMPARE_KEY, candidate),
      hmac(COMPARE_KEY, env.ACCESS_PASSWORD),
    ]);
    return safeEqual(a, b);
  }

  if (!storedHash) return false;
  return safeEqual(await hashPassword(secret, candidate), storedHash);
}
