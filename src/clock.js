// The "format clock" — the repeating hour template every real radio station
// runs. It is what makes a station feel endlessly fresh but reliably the same
// show. Here it does double duty: the rerun slot is spaced repetition wearing a
// radio costume, so review is a corner of the programme rather than homework.
//
// Deliberately pure: it takes the data and returns a decision, so the whole
// programming policy is testable without KV, network, or a running Worker.

export const CLOCK = [
  { corner: "station_id", label: "Station ID" },
  { corner: "main", label: "Main segment" },
  { corner: "quiz", label: "Quiz corner" },
  { corner: "main", label: "Main segment" },
  { corner: "mail", label: "Listener mail" },
  { corner: "rerun", label: "Requested again" },
  { corner: "main", label: "Main segment" },
];

const MAIN = { corner: "main", label: "Main segment" };

// Least-recently-aired source, so the whole library gets airtime instead of the
// newest arrival hogging the microphone.
function pickSource(sources, excludeId) {
  const pool = sources.filter((s) => s.id !== excludeId);
  const candidates = pool.length ? pool : sources;
  if (!candidates.length) return null;
  return [...candidates].sort(
    (a, b) => a.airedCount - b.airedCount || new Date(a.createdAt) - new Date(b.createdAt)
  )[0];
}

// Worth hearing again: already aired, fewest plays, longest since it last ran.
function pickRerun(segments) {
  const eligible = segments.filter(
    (s) => s.corner !== "station_id" && s.corner !== "rerun" && s.playCount > 0
  );
  if (!eligible.length) return null;
  return [...eligible].sort(
    (a, b) =>
      a.playCount - b.playCount ||
      new Date(a.lastPlayedAt || 0) - new Date(b.lastPlayedAt || 0)
  )[0];
}

// Never been on air = new mail. Sources are newest-first, so this finds the
// most recent thing the listener sent in.
const pickUnaired = (sources) => sources.find((s) => s.airedCount === 0) || null;

/**
 * Decide what airs next.
 * @param {object} opts
 * @param {number} opts.position       slots already played
 * @param {string|null} opts.lastSourceId  avoid two segments on the same source back to back
 * @param {Array} opts.sources
 * @param {Array} opts.segments
 * @param {Array} opts.words           vocabulary introduced so far
 * @returns {{corner, label, source, rerunOf}} always a slot — see the welcome case
 */
export function nextSlot({ position = 0, lastSourceId = null, sources = [], segments = [], words = [] }) {
  // A station with nothing in the library is still on the air. Going silent and
  // showing an error is the one thing radio never does, and the hosts asking for
  // material is a better prompt than a toast telling you the form is empty.
  if (!sources.length) {
    return { corner: "welcome", label: "Station ID", source: null, rerunOf: null };
  }

  let slot = CLOCK[position % CLOCK.length];

  // Early on, some corners have nothing to work with. Rather than airing dead
  // time, fall back to a main segment until the station has enough history.
  if (slot.corner === "rerun" && !pickRerun(segments)) slot = MAIN;
  if (slot.corner === "mail" && !pickUnaired(sources)) slot = MAIN;
  if (slot.corner === "quiz" && words.length < 3) slot = MAIN;

  if (slot.corner === "rerun") return { ...slot, source: null, rerunOf: pickRerun(segments) };
  if (slot.corner === "mail") return { ...slot, source: pickUnaired(sources), rerunOf: null };
  if (slot.corner === "quiz" || slot.corner === "station_id") {
    return { ...slot, source: null, rerunOf: null };
  }
  return { ...slot, source: pickSource(sources, lastSourceId), rerunOf: null };
}
