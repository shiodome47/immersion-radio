// Immerse FM — the receiver.
//
// Speech uses the browser's built-in SpeechSynthesis so the station runs with
// zero TTS spend while the format is being tuned. Everything downstream of
// `speakTurn` is deliberately swappable: point it at a server route that
// returns audio (Gemini's multi-speaker TTS renders both hosts and the
// (laughs) cues in one call) and the rest of the player is unchanged.

const $ = (id) => document.getElementById(id);

const state = {
  playing: false,
  position: 0,        // how far around the format clock we've walked
  lastSourceId: null,
  segment: null,
  voices: { A: null, B: null },
  skip: false,
};

/* ------------------------------------------------------------------ voices */

// Two clearly different English voices, so turn-taking is audible.
function pickVoices() {
  const all = speechSynthesis.getVoices().filter((v) => v.lang.startsWith("en"));
  if (!all.length) return;

  const score = (v, wanted) => {
    const n = v.name.toLowerCase();
    const femaleish = /female|samantha|victoria|karen|moira|tessa|zira|joanna|aria|jenny/.test(n);
    const maleish = /male|daniel|alex|fred|george|rishi|guy|davis|ryan|brian/.test(n);
    let s = v.localService ? 2 : 0;
    if (wanted === "f" && femaleish) s += 6;
    if (wanted === "m" && maleish) s += 6;
    return s;
  };

  const byScore = (wanted) => [...all].sort((a, b) => score(b, wanted) - score(a, wanted))[0];

  state.voices.A = byScore("f");
  state.voices.B = byScore("m");

  // If the heuristics collapsed onto one voice, force them apart.
  if (state.voices.A === state.voices.B && all.length > 1) {
    state.voices.B = all.find((v) => v !== state.voices.A) || state.voices.B;
  }
}
speechSynthesis.addEventListener("voiceschanged", pickVoices);
pickVoices();

/* ------------------------------------------------------------- transcript */

// "(laughs)" is a performance note, not a word to pronounce. Split it out so the
// transcript can show it while the speech engine skips it.
function splitNonverbal(text) {
  return text.split(/(\([^)]{1,40}\))/g).filter(Boolean);
}

const spokenText = (text) => text.replace(/\([^)]{1,40}\)/g, " ").replace(/\s+/g, " ").trim();

function renderSegment(segment) {
  $("cornerTag").textContent = segment.rerun
    ? `${segment.label || "Requested again"} · rerun`
    : segment.label || segment.corner;
  $("segmentTitle").textContent = segment.title;

  const src = segment.sourceId;
  $("segmentSub").textContent = segment.mock
    ? "Mock script — set ANTHROPIC_API_KEY for real ones."
    : src
      ? "From your library"
      : "Immerse FM";

  const script = $("script");
  script.innerHTML = "";
  segment.turns.forEach((turn, i) => {
    const el = document.createElement("div");
    el.className = `turn ${turn.speaker === "B" ? "b" : "a"}`;
    el.dataset.index = String(i);

    const who = document.createElement("div");
    who.className = "who";
    who.textContent = turn.speaker === "B" ? "Theo" : "Maya";

    const line = document.createElement("div");
    line.className = "line";
    for (const part of splitNonverbal(turn.text)) {
      const span = document.createElement("span");
      if (part.startsWith("(") && part.endsWith(")")) span.className = "nonverbal";
      span.textContent = part;
      line.appendChild(span);
    }

    el.append(who, line);
    script.appendChild(el);
  });

  const words = $("words");
  words.innerHTML = "";
  for (const w of segment.newWords || []) {
    const chip = document.createElement("div");
    chip.className = "chip";
    chip.innerHTML = `<b></b> <span></span>`;
    chip.querySelector("b").textContent = w.word;
    chip.querySelector("span").textContent = w.meaning ? `— ${w.meaning}` : "";
    words.appendChild(chip);
  }
}

function setSpeaking(speaker) {
  document.querySelector(".host-a").classList.toggle("speaking", speaker === "A");
  document.querySelector(".host-b").classList.toggle("speaking", speaker === "B");
}

/* ---------------------------------------------------------------- speaking */

function speakTurn(turn) {
  return new Promise((resolve) => {
    const text = spokenText(turn.text);
    if (!text) return resolve();

    const u = new SpeechSynthesisUtterance(text);
    const voice = state.voices[turn.speaker] || state.voices.A;
    if (voice) u.voice = voice;
    u.rate = turn.speaker === "B" ? 0.97 : 1.02;
    u.pitch = turn.speaker === "B" ? 0.9 : 1.1;

    u.onend = resolve;
    u.onerror = resolve; // never wedge the station on one bad utterance
    speechSynthesis.speak(u);
  });
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function playSegment(segment) {
  renderSegment(segment);
  for (let i = 0; i < segment.turns.length; i++) {
    if (!state.playing || state.skip) return;
    const turn = segment.turns[i];
    highlightTurn(i);
    setSpeaking(turn.speaker);
    await speakTurn(turn);
    await pause(160); // a beat between turns, so it breathes
  }
  setSpeaking(null);
}

function highlightTurn(index) {
  for (const el of document.querySelectorAll(".turn")) {
    el.classList.toggle("active", Number(el.dataset.index) === index);
  }
  const active = document.querySelector(".turn.active");
  if (active && $("showScript").checked) {
    active.scrollIntoView({ block: "center", behavior: "smooth" });
  }
}

/* ----------------------------------------------------------------- station */

async function fetchNext() {
  const res = await fetch("/api/next", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ position: state.position, lastSourceId: state.lastSourceId }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "the station went quiet");
  return res.json();
}

// The loop that makes this a radio instead of a button: it never stops on its own.
async function broadcast() {
  while (state.playing) {
    try {
      $("segmentSub").textContent = "Coming up next…";
      const segment = await fetchNext();
      state.segment = segment;
      state.position += 1;
      if (segment.sourceId) state.lastSourceId = segment.sourceId;
      state.skip = false;
      await playSegment(segment);
    } catch (err) {
      $("segmentTitle").textContent = "Off air";
      $("segmentSub").textContent = err.message;
      stop();
      return;
    }
  }
}

function start() {
  if (state.playing) return;
  state.playing = true;
  $("onair").classList.add("live");
  $("onair").textContent = "ON AIR";
  $("playBtn").textContent = "⏸  Stop";
  $("skipBtn").disabled = false;
  broadcast();
}

function stop() {
  state.playing = false;
  speechSynthesis.cancel();
  setSpeaking(null);
  $("onair").classList.remove("live");
  $("onair").textContent = "OFF AIR";
  $("playBtn").textContent = "▶  Tune in";
  $("skipBtn").disabled = true;
}

/* -------------------------------------------------------------------- wiring */

$("playBtn").addEventListener("click", () => (state.playing ? stop() : start()));

$("skipBtn").addEventListener("click", () => {
  // Drop out of the current segment; the broadcast loop pulls the next one.
  state.skip = true;
  speechSynthesis.cancel();
});

$("showScript").addEventListener("change", (e) => {
  $("script").style.display = e.target.checked ? "" : "none";
});

$("sourceForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = {
    type: $("type").value,
    title: $("title").value,
    url: $("url").value,
    content: $("content").value,
  };
  const res = await fetch("/api/sources", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    $("formHint").textContent = (await res.json().catch(() => ({}))).error || "could not send that in";
    return;
  }
  $("title").value = "";
  $("url").value = "";
  $("content").value = "";
  $("formHint").textContent = "Sent in — the hosts will get to it.";
  setTimeout(() => ($("formHint").textContent = ""), 4000);
  loadSources();
});

$("level").addEventListener("change", async (e) => {
  await fetch("/api/level", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ level: e.target.value }),
  });
});

async function loadSources() {
  const sources = await (await fetch("/api/sources")).json();
  const ul = $("sources");
  ul.innerHTML = "";
  if (!sources.length) {
    ul.innerHTML = `<li class="empty" style="display:block">Nothing in rotation yet.</li>`;
    return;
  }
  for (const s of sources) {
    const li = document.createElement("li");
    const left = document.createElement("div");
    const name = document.createElement("div");
    name.className = "name";
    name.textContent = s.title;
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = `${s.type} · aired ${s.airedCount}×`;
    left.append(name, meta);

    const del = document.createElement("button");
    del.textContent = "remove";
    del.addEventListener("click", async () => {
      await fetch(`/api/sources/${s.id}`, { method: "DELETE" });
      loadSources();
    });

    li.append(left, del);
    ul.appendChild(li);
  }
}

/* --------------------------------------------------------------------- lock */

$("lockForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const res = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: $("password").value }),
  });
  if (!res.ok) {
    $("lockHint").textContent = (await res.json().catch(() => ({}))).error || "Could not unlock.";
    return;
  }
  $("password").value = "";
  $("lockHint").textContent = "";
  openStation();
});

$("logoutBtn").addEventListener("click", async () => {
  stop();
  await fetch("/api/logout", { method: "POST" });
  $("shell").hidden = true;
  $("lock").hidden = false;
});

async function openStation() {
  $("lock").hidden = true;
  $("shell").hidden = false;
  const station = await (await fetch("/api/station")).json();
  $("level").value = station.level;
  $("modeNote").textContent = station.hasKey
    ? `Scripts written by ${station.model} · spoken by your browser`
    : `No ANTHROPIC_API_KEY set — playing canned mock scripts.`;
  loadSources();
}

async function boot() {
  const session = await (await fetch("/api/session")).json();

  if (!session.configured) {
    // Refusing to open beats silently serving a public station: this app holds
    // whatever you sent it, meeting transcripts included.
    $("lock").hidden = false;
    $("lockHint").textContent =
      "Not configured. Set ACCESS_PASSWORD and SESSION_SECRET, then reload.";
    $("password").disabled = true;
    $("lockForm").querySelector("button").disabled = true;
    return;
  }

  if (session.authed) return openStation();
  $("lock").hidden = false;
}

boot();
