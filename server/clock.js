// The "format clock" — the repeating hour template every real radio station runs.
// It is what makes a station feel both endlessly fresh and reliably the same show.
// Here it also does double duty: the rerun slot is spaced repetition in disguise.
import { store } from "./store.js";

// One turn of the wheel. The station walks this in order, forever.
export const CLOCK = [
  { corner: "station_id", label: "Station ID" },
  { corner: "main", label: "Main segment" },
  { corner: "quiz", label: "Quiz corner" },
  { corner: "main", label: "Main segment" },
  { corner: "mail", label: "Listener mail" },
  { corner: "rerun", label: "Requested again" },
  { corner: "main", label: "Main segment" },
];

// Least-recently-aired source, so the whole library gets airtime instead of
// the newest item hogging the microphone.
function pickSource(sources, excludeId) {
  const pool = sources.filter((s) => s.id !== excludeId);
  const candidates = pool.length ? pool : sources;
  if (!candidates.length) return null;
  return [...candidates].sort((a, b) => {
    if (a.airedCount !== b.airedCount) return a.airedCount - b.airedCount;
    return new Date(a.createdAt) - new Date(b.createdAt);
  })[0];
}

// A segment worth hearing again: aired at least once, longest ago, fewest plays.
function pickRerun(segments) {
  const eligible = segments.filter(
    (s) => s.corner !== "station_id" && s.corner !== "rerun" && s.playCount > 0
  );
  if (!eligible.length) return null;
  return [...eligible].sort((a, b) => {
    if (a.playCount !== b.playCount) return a.playCount - b.playCount;
    return new Date(a.lastPlayedAt || 0) - new Date(b.lastPlayedAt || 0);
  })[0];
}

// A source that has never been on air yet is "new mail".
function pickUnaired(sources) {
  return sources.find((s) => s.airedCount === 0) || null;
}

/**
 * Decide what airs next.
 * @param {object} opts
 * @param {number} opts.position  How many slots the station has already played.
 * @param {string} [opts.lastSourceId]  Avoid talking about the same source twice in a row.
 * @returns {{corner: string, label: string, source: object|null, rerunOf: object|null}|null}
 */
export function nextSlot({ position = 0, lastSourceId = null } = {}) {
  const sources = store.listSources();
  if (!sources.length) return null; // Nothing to broadcast yet.

  const segments = store.listSegments();
  let slot = CLOCK[position % CLOCK.length];

  // Graceful degradation: early on, some corners have nothing to work with.
  // Rather than airing dead time, fall back to a main segment.
  if (slot.corner === "rerun" && !pickRerun(segments)) {
    slot = { corner: "main", label: "Main segment" };
  }
  if (slot.corner === "mail" && !pickUnaired(sources)) {
    slot = { corner: "main", label: "Main segment" };
  }
  if (slot.corner === "quiz" && store.recentWords(6).length < 3) {
    slot = { corner: "main", label: "Main segment" };
  }

  if (slot.corner === "rerun") {
    return { ...slot, source: null, rerunOf: pickRerun(segments) };
  }
  if (slot.corner === "mail") {
    return { ...slot, source: pickUnaired(sources), rerunOf: null };
  }
  if (slot.corner === "quiz" || slot.corner === "station_id") {
    return { ...slot, source: null, rerunOf: null };
  }
  return { ...slot, source: pickSource(sources, lastSourceId), rerunOf: null };
}
