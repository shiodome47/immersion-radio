import { Station, getStation, recentWords } from "./station.js";
import { nextSlot, CLOCK } from "./clock.js";
import { writeSegment } from "./generate.js";
import {
  isAuthed,
  verifyPassword,
  hashPassword,
  hasPassword,
  issueCookie,
  clearCookie,
} from "./auth.js";

const json = (data, init = {}) =>
  new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers || {}) },
  });

const LEVELS = ["A1", "A2", "B1", "B2", "C1"];

async function handleApi(request, env, url) {
  const path = url.pathname;
  const method = request.method;

  // --- unauthenticated surface: just enough to render the lock screen ---

  const station = getStation(env);

  // A forgotten password would otherwise need dashboard surgery. This lets the
  // reset ride along with a deploy instead.
  if (env.RESET_STATION) await station.consumeReset(env.RESET_STATION);

  const [secret, storedHash] = await Promise.all([
    station.getSessionSecret(),
    station.getPasswordHash(),
  ]);
  const locked = hasPassword(env, storedHash);
  const authed = await isAuthed(request, { env, secret, storedHash });

  if (path === "/api/session" && method === "GET") {
    return json({ needsSetup: !locked, authed });
  }

  // Deliberately unauthenticated, and deliberately boolean-only: enough to tell
  // a deployed station apart from the one on your laptop without disclosing
  // anything a stranger could use. Diagnosing production by screenshot is slow
  // and mostly guesswork.
  if (path === "/api/diag" && method === "GET") {
    return json({
      build: env.BUILD_MARKER || "unknown",
      hasStoredPassword: Boolean(storedHash),
      hasAccessPasswordVar: Boolean(env.ACCESS_PASSWORD),
      resetFlagPresent: Boolean(env.RESET_STATION),
      resetAlreadyConsumed: await station.resetConsumed(),
      cookiePresent: Boolean(request.headers.get("Cookie")),
      authed,
      https: url.protocol === "https:",
    });
  }

  // First run: whoever opens the freshly deployed station chooses its password.
  // Only reachable while no password exists, and claimPassword refuses to
  // overwrite, so this closes permanently the moment it is used once.
  if (path === "/api/setup" && method === "POST") {
    if (locked) return json({ error: "Already set up." }, { status: 409 });

    const { password } = await request.json().catch(() => ({}));
    if (String(password ?? "").length < 6) {
      return json({ error: "Use at least 6 characters." }, { status: 400 });
    }
    if (!(await station.claimPassword(await hashPassword(secret, password)))) {
      return json({ error: "Already set up." }, { status: 409 });
    }
    return json({ ok: true }, { headers: { "Set-Cookie": await issueCookie(secret) } });
  }

  if (path === "/api/login" && method === "POST") {
    if (!locked) {
      return json({ error: "No password set yet — choose one first." }, { status: 409 });
    }
    const { password } = await request.json().catch(() => ({}));
    if (!(await verifyPassword({ env, secret, storedHash, submitted: password }))) {
      return json({ error: "Wrong password." }, { status: 401 });
    }
    return json({ ok: true }, { headers: { "Set-Cookie": await issueCookie(secret) } });
  }

  if (path === "/api/logout" && method === "POST") {
    return json({ ok: true }, { headers: { "Set-Cookie": clearCookie() } });
  }

  // --- everything past here is private ---

  if (!authed) {
    return json({ error: "Locked." }, { status: 401 });
  }

  if (path === "/api/station" && method === "GET") {
    const { level, sources, segments } = await station.snapshot();
    return json({
      level,
      sources,
      clock: CLOCK,
      segmentCount: segments.length,
      hasKey: Boolean(env.ANTHROPIC_API_KEY),
      model: env.IMMERSE_MODEL || "claude-sonnet-5",
    });
  }

  if (path === "/api/level" && method === "PUT") {
    const { level } = await request.json().catch(() => ({}));
    if (!LEVELS.includes(level)) {
      return json({ error: `level must be one of ${LEVELS.join(" ")}` }, { status: 400 });
    }
    return json({ level: await station.setLevel(level) });
  }

  if (path === "/api/sources" && method === "GET") {
    return json(await station.listSources());
  }

  if (path === "/api/sources" && method === "POST") {
    const body = await request.json().catch(() => ({}));
    if (!String(body.content || "").trim() && !String(body.title || "").trim()) {
      return json(
        { error: "give the show something to work with: a title or some text" },
        { status: 400 }
      );
    }
    return json(await station.addSource(body), { status: 201 });
  }

  const sourceMatch = path.match(/^\/api\/sources\/([\w-]+)$/);
  if (sourceMatch && method === "DELETE") {
    if (!(await station.removeSource(sourceMatch[1]))) {
      return json({ error: "not found" }, { status: 404 });
    }
    return new Response(null, { status: 204 });
  }

  if (path === "/api/segments" && method === "GET") {
    return json(await station.listSegments());
  }

  // The heart of the station: hand back whatever airs next.
  if (path === "/api/next" && method === "POST") {
    const { position = 0, lastSourceId = null } = await request.json().catch(() => ({}));
    const { level, sources, segments } = await station.snapshot();

    const slot = nextSlot({
      position,
      lastSourceId,
      sources,
      segments,
      words: recentWords(segments, 6),
    });

    // Reruns cost nothing: no generation, and the listener meets the same
    // vocabulary again a few slots later.
    if (slot.corner === "rerun" && slot.rerunOf) {
      await station.markSegmentPlayed(slot.rerunOf.id);
      return json({ ...slot.rerunOf, corner: "rerun", label: slot.label, rerun: true });
    }

    const written = await writeSegment({
      corner: slot.corner,
      source: slot.source,
      level,
      words: recentWords(segments),
      env,
    });

    // The welcome is filler until there is a library; banking it would pad the
    // rotation with the hosts apologising for having nothing to play.
    if (slot.corner === "welcome") {
      return json({ ...written, label: slot.label, rerun: false });
    }

    const saved = await station.addSegment(written);
    await station.markSegmentPlayed(saved.id);
    if (slot.source) await station.markSourceAired(slot.source.id);

    return json({ ...saved, label: slot.label, rerun: false });
  }

  return json({ error: "not found" }, { status: 404 });
}

export { Station };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      try {
        return await handleApi(request, env, url);
      } catch (err) {
        console.error("[api]", err);
        return json({ error: err.message || "internal error" }, { status: 500 });
      }
    }

    return env.ASSETS.fetch(request);
  },
};
