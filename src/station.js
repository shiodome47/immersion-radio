// The station's memory, as a Durable Object.
//
// Chosen over KV for two reasons. Practically: a Durable Object needs no
// pre-provisioned resource id, so `wrangler deploy` creates it on first use and
// there is no namespace to make by hand — which matters when you never touch a
// terminal. Structurally: this state is read-modify-write (bump a play count,
// append a segment), and KV is eventually consistent with no way to serialise
// that. A Durable Object serialises access by construction, so the races that
// design had are gone rather than merely unlikely.
//
// One listener, one station, so everything lives in a single instance.

import { DurableObject } from "cloudflare:workers";

const MAX_SEGMENTS = 300;

const newId = () =>
  Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export class Station extends DurableObject {
  async #read(key, fallback) {
    return (await this.ctx.storage.get(key)) ?? fallback;
  }

  async getLevel() {
    return this.#read("level", "B1");
  }

  async setLevel(level) {
    await this.ctx.storage.put("level", level);
    return level;
  }

  listSources() {
    return this.#read("sources", []);
  }

  listSegments() {
    return this.#read("segments", []);
  }

  // Everything the receiver needs to draw itself, in one round trip.
  async snapshot() {
    const [level, sources, segments] = await Promise.all([
      this.getLevel(),
      this.listSources(),
      this.listSegments(),
    ]);
    return { level, sources, segments };
  }

  async addSource({ type, title, url, content }) {
    const sources = await this.listSources();
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
    await this.ctx.storage.put("sources", sources);
    return source;
  }

  async removeSource(id) {
    const sources = await this.listSources();
    const kept = sources.filter((s) => s.id !== id);
    if (kept.length === sources.length) return false;
    await this.ctx.storage.put("sources", kept);
    return true;
  }

  async markSourceAired(id) {
    const sources = await this.listSources();
    const source = sources.find((s) => s.id === id);
    if (!source) return;
    source.airedCount += 1;
    await this.ctx.storage.put("sources", sources);
  }

  async addSegment(segment) {
    const segments = await this.listSegments();
    const saved = {
      id: newId(),
      createdAt: new Date().toISOString(),
      playCount: 0,
      lastPlayedAt: null,
      ...segment,
    };
    segments.unshift(saved);
    if (segments.length > MAX_SEGMENTS) segments.length = MAX_SEGMENTS;
    await this.ctx.storage.put("segments", segments);
    return saved;
  }

  async markSegmentPlayed(id) {
    const segments = await this.listSegments();
    const segment = segments.find((s) => s.id === id);
    if (!segment) return;
    segment.playCount += 1;
    segment.lastPlayedAt = new Date().toISOString();
    await this.ctx.storage.put("segments", segments);
  }
}

// There is exactly one station, so every request routes to the same instance.
export const getStation = (env) => env.STATION.get(env.STATION.idFromName("station"));

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
