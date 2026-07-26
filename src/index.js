import { createStore, recentWords } from "./store.js";
import { nextSlot, CLOCK } from "./clock.js";
import { writeSegment } from "./generate.js";
import { isAuthed, checkPassword, issueCookie, clearCookie, configured } from "./auth.js";

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

  if (path === "/api/session" && method === "GET") {
    return json({ configured: configured(env), authed: await isAuthed(request, env) });
  }

  if (path === "/api/login" && method === "POST") {
    if (!configured(env)) {
      return json(
        { error: "The station is not configured yet. Set ACCESS_PASSWORD and SESSION_SECRET." },
        { status: 503 }
      );
    }
    const { password } = await request.json().catch(() => ({}));
    if (!(await checkPassword(env, password))) {
      return json({ error: "Wrong password." }, { status: 401 });
    }
    return json({ ok: true }, { headers: { "Set-Cookie": await issueCookie(env) } });
  }

  if (path === "/api/logout" && method === "POST") {
    return json({ ok: true }, { headers: { "Set-Cookie": clearCookie() } });
  }

  // --- everything past here is private ---

  if (!(await isAuthed(request, env))) {
    return json({ error: "Locked." }, { status: 401 });
  }

  const store = createStore(env);

  if (path === "/api/station" && method === "GET") {
    const [level, sources, segments] = await Promise.all([
      store.getLevel(),
      store.listSources(),
      store.listSegments(),
    ]);
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
    return json({ level: await store.setLevel(level) });
  }

  if (path === "/api/sources" && method === "GET") {
    return json(await store.listSources());
  }

  if (path === "/api/sources" && method === "POST") {
    const body = await request.json().catch(() => ({}));
    if (!String(body.content || "").trim() && !String(body.title || "").trim()) {
      return json(
        { error: "give the show something to work with: a title or some text" },
        { status: 400 }
      );
    }
    return json(await store.addSource(body), { status: 201 });
  }

  const sourceMatch = path.match(/^\/api\/sources\/([\w-]+)$/);
  if (sourceMatch && method === "DELETE") {
    if (!(await store.removeSource(sourceMatch[1]))) {
      return json({ error: "not found" }, { status: 404 });
    }
    return new Response(null, { status: 204 });
  }

  if (path === "/api/segments" && method === "GET") {
    return json(await store.listSegments());
  }

  // The heart of the station: hand back whatever airs next.
  if (path === "/api/next" && method === "POST") {
    const { position = 0, lastSourceId = null } = await request.json().catch(() => ({}));
    const [level, sources, segments] = await Promise.all([
      store.getLevel(),
      store.listSources(),
      store.listSegments(),
    ]);

    const slot = nextSlot({
      position,
      lastSourceId,
      sources,
      segments,
      words: recentWords(segments, 6),
    });

    if (!slot) {
      return json(
        { error: "The station has nothing to broadcast yet — send the show something first." },
        { status: 409 }
      );
    }

    // Reruns cost nothing: no generation, and the listener meets the same
    // vocabulary again a few slots later.
    if (slot.corner === "rerun" && slot.rerunOf) {
      await store.markSegmentPlayed(slot.rerunOf.id);
      return json({ ...slot.rerunOf, corner: "rerun", label: slot.label, rerun: true });
    }

    const written = await writeSegment({
      corner: slot.corner,
      source: slot.source,
      level,
      words: recentWords(segments),
      env,
    });

    const saved = await store.addSegment(written);
    await store.markSegmentPlayed(saved.id);
    if (slot.source) await store.markSourceAired(slot.source.id);

    return json({ ...saved, label: slot.label, rerun: false });
  }

  return json({ error: "not found" }, { status: 404 });
}

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
