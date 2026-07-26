// Workers KV backed store.
//
// Single tenant by design — this is one person's station — so the whole state
// lives under three keys and is read/modified/written wholesale. KV is
// eventually consistent and has no transactions; with one listener that is
// fine. If this ever goes multi-user, move to D1 and give each account a row.

const KEYS = { level: "level", sources: "sources", segments: "segments" };
const MAX_SEGMENTS = 300;

async function readJson(env, key, fallback) {
  const raw = await env.STATION.get(key, "json");
  return raw ?? fallback;
}

const writeJson = (env, key, value) => env.STATION.put(key, JSON.stringify(value));

function newId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function createStore(env) {
  return {
    async getLevel() {
      return (await env.STATION.get(KEYS.level)) || "B1";
    },

    async setLevel(level) {
      await env.STATION.put(KEYS.level, level);
      return level;
    },

    listSources: () => readJson(env, KEYS.sources, []),

    listSegments: () => readJson(env, KEYS.segments, []),

    async addSource({ type, title, url, content }) {
      const sources = await readJson(env, KEYS.sources, []);
      const source = {
        id: newId(),
        type: type || "text",
        title: (title || "").trim() || "Untitled",
        url: (url || "").trim(),
        content: (content || "").trim(),
        createdAt: new Date().toISOString(),
        airedCount: 0,
      };
      sources.unshift(source);
      await writeJson(env, KEYS.sources, sources);
      return source;
    },

    async removeSource(id) {
      const sources = await readJson(env, KEYS.sources, []);
      const kept = sources.filter((s) => s.id !== id);
      if (kept.length === sources.length) return false;
      await writeJson(env, KEYS.sources, kept);
      return true;
    },

    async markSourceAired(id) {
      const sources = await readJson(env, KEYS.sources, []);
      const source = sources.find((s) => s.id === id);
      if (!source) return;
      source.airedCount += 1;
      await writeJson(env, KEYS.sources, sources);
    },

    async addSegment(segment) {
      const segments = await readJson(env, KEYS.segments, []);
      const saved = {
        id: newId(),
        createdAt: new Date().toISOString(),
        playCount: 0,
        lastPlayedAt: null,
        ...segment,
      };
      segments.unshift(saved);
      if (segments.length > MAX_SEGMENTS) segments.length = MAX_SEGMENTS;
      await writeJson(env, KEYS.segments, segments);
      return saved;
    },

    async markSegmentPlayed(id) {
      const segments = await readJson(env, KEYS.segments, []);
      const segment = segments.find((s) => s.id === id);
      if (!segment) return;
      segment.playCount += 1;
      segment.lastPlayedAt = new Date().toISOString();
      await writeJson(env, KEYS.segments, segments);
    },
  };
}

// Vocabulary the hosts have already introduced. The quiz corner draws on it and
// the writers' room is told to recycle it — that recurrence is what makes words
// stick rather than wash past.
export function recentWords(segments, limit = 24) {
  const words = [];
  for (const segment of segments) {
    for (const w of segment.newWords || []) {
      if (!words.some((x) => x.word.toLowerCase() === w.word.toLowerCase())) words.push(w);
      if (words.length >= limit) return words;
    }
  }
  return words;
}
