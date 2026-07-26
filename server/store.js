// Tiny JSON-file backed store. Good enough for an MVP; swap for a real DB later.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_FILE = resolve(__dirname, "../data/store.json");

const DEFAULTS = {
  // CEFR-ish proficiency the listener is currently at. The radio aims one
  // notch above this ("i + 1").
  level: "B1",
  sources: [], // { id, type, title, url, content, createdAt }
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

function id() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export const store = {
  getState() {
    return structuredClone(state);
  },

  getLevel() {
    return state.level;
  },

  setLevel(level) {
    state.level = level;
    persist();
    return state.level;
  },

  listSources() {
    return structuredClone(state.sources);
  },

  getSource(sourceId) {
    return state.sources.find((s) => s.id === sourceId) || null;
  },

  addSource({ type, title, url, content }) {
    const source = {
      id: id(),
      type: type || "text",
      title: (title || "").trim() || "Untitled",
      url: (url || "").trim(),
      content: (content || "").trim(),
      createdAt: new Date().toISOString(),
    };
    state.sources.unshift(source);
    persist();
    return source;
  },

  removeSource(sourceId) {
    const before = state.sources.length;
    state.sources = state.sources.filter((s) => s.id !== sourceId);
    persist();
    return state.sources.length < before;
  },
};
