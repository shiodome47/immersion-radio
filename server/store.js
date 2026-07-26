// Tiny JSON-file backed store. Good enough for an MVP; swap for a real DB later.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_FILE = resolve(__dirname, "../data/store.json");

const DEFAULTS = {
  // CEFR-ish level the listener is at now. The show aims one notch above ("i + 1").
  level: "B1",
  // Material the listener sent in. Diegetically these are "letters to the show".
  sources: [], // { id, type, title, url, content, createdAt, airedCount }
  // Every segment we've ever produced. Kept so the station can rerun them —
  // heavy rotation is how real radio works, and repetition is how vocabulary sticks.
  segments: [], // { id, corner, title, turns, newWords, sourceId, createdAt, playCount, lastPlayedAt }
};

let state = load();

function load() {
  try {
    if (existsSync(DATA_FILE)) {
      const raw = JSON.parse(readFileSync(DATA_FILE, "utf8"));
      return { ...structuredClone(DEFAULTS), ...raw };
    }
  } catch (err) {
    console.warn("[store] could not read store.json, starting fresh:", err.message);
  }
  return structuredClone(DEFAULTS);
}

function persist() {
  try {
    mkdirSync(dirname(DATA_FILE), { recursive: true });
    writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
  } catch (err) {
    console.error("[store] failed to persist:", err.message);
  }
}

function newId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export const store = {
  getLevel: () => state.level,

  setLevel(level) {
    state.level = level;
    persist();
    return state.level;
  },

  listSources: () => structuredClone(state.sources),

  getSource: (id) => state.sources.find((s) => s.id === id) || null,

  addSource({ type, title, url, content }) {
    const source = {
      id: newId(),
      type: type || "text",
      title: (title || "").trim() || "Untitled",
      url: (url || "").trim(),
      content: (content || "").trim(),
      createdAt: new Date().toISOString(),
      airedCount: 0,
    };
    state.sources.unshift(source);
    persist();
    return source;
  },

  removeSource(id) {
    const before = state.sources.length;
    state.sources = state.sources.filter((s) => s.id !== id);
    persist();
    return state.sources.length < before;
  },

  markSourceAired(id) {
    const source = state.sources.find((s) => s.id === id);
    if (source) {
      source.airedCount += 1;
      persist();
    }
  },

  listSegments: () => structuredClone(state.segments),

  getSegment: (id) => state.segments.find((s) => s.id === id) || null,

  addSegment(segment) {
    const saved = {
      id: newId(),
      createdAt: new Date().toISOString(),
      playCount: 0,
      lastPlayedAt: null,
      ...segment,
    };
    state.segments.unshift(saved);
    // Keep the library bounded so the JSON file doesn't grow forever.
    if (state.segments.length > 300) state.segments.length = 300;
    persist();
    return saved;
  },

  markSegmentPlayed(id) {
    const segment = state.segments.find((s) => s.id === id);
    if (segment) {
      segment.playCount += 1;
      segment.lastPlayedAt = new Date().toISOString();
      persist();
    }
  },

  // Words the hosts have introduced recently — the quiz corner draws from these,
  // and the script writer is told to recycle them.
  recentWords(limit = 24) {
    const words = [];
    for (const segment of state.segments) {
      for (const w of segment.newWords || []) {
        if (!words.some((x) => x.word.toLowerCase() === w.word.toLowerCase())) {
          words.push(w);
        }
        if (words.length >= limit) return words;
      }
    }
    return words;
  },
};
