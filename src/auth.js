// An optional lock.
//
// The station holds whatever you send it, and you are invited to send it
// meeting recordings — so once there is anything in it worth reading, a public
// URL is a real problem. But an empty station has nothing to protect, and a
// lock that engages before there is anything behind it only locks out the
// person who just deployed it. That is exactly what happened here.
//
// So: locked when ACCESS_PASSWORD is set, open when it is not. One secret, in
// the dashboard, whenever you decide the library is worth locking. No first-run
// claim, no stored hash, no reset token — that machinery existed to avoid
// asking for one secret, and cost far more than it saved.

const COOKIE = "immerse_session";
const TTL_SECONDS = 60 * 60 * 24 * 30;

// Lax rather than Strict: Strict withholds the cookie on cross-site
// navigations, so arriving by link — the Cloudflare dashboard's own Visit
// button — would land you on the lock screen with a perfectly valid session.
// Lax still withholds it from cross-site POSTs, and every route that changes
// anything here is POST, PUT or DELETE.
const COOKIE_ATTRS = "HttpOnly; Secure; SameSite=Lax; Path=/";

// Normalises both sides of a comparison to a fixed length. Not a secret.
const COMPARE_KEY = "immerse-fm/password-compare";

const enc = new TextEncoder();

async function hmac(key, message) {
  const imported = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", imported, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Comparison that doesn't leak how much of the value matched via timing.
function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const isLocked = (env) => Boolean(env.ACCESS_PASSWORD);

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

export async function isAuthed(request, env, secret) {
  if (!isLocked(env)) return true; // Nothing to prove.

  const raw = readCookie(request);
  if (!raw) return false;

  const [expires, sig] = raw.split(".");
  if (!expires || !sig) return false;
  if (Number(expires) < Date.now()) return false;

  return safeEqual(sig, await hmac(secret, expires));
}

export async function verifyPassword(env, submitted) {
  if (!isLocked(env)) return false;
  const candidate = String(submitted ?? "");
  if (!candidate) return false;

  const [a, b] = await Promise.all([
    hmac(COMPARE_KEY, candidate),
    hmac(COMPARE_KEY, env.ACCESS_PASSWORD),
  ]);
  return safeEqual(a, b);
}
