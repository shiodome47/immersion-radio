import "dotenv/config";
import express from "express";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { store } from "./store.js";
import { nextSlot, CLOCK } from "./clock.js";
import { writeSegment, generationInfo } from "./generate.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json({ limit: "2mb" }));
app.use(express.static(resolve(__dirname, "../public")));

const wrap = (fn) => (req, res) => fn(req, res).catch((err) => {
  console.error("[api]", err);
  res.status(500).json({ error: err.message || "internal error" });
});

app.get("/api/station", (_req, res) => {
  res.json({
    level: store.getLevel(),
    sources: store.listSources(),
    clock: CLOCK,
    segmentCount: store.listSegments().length,
    ...generationInfo(),
  });
});

app.put("/api/level", (req, res) => {
  const { level } = req.body || {};
  if (!["A1", "A2", "B1", "B2", "C1"].includes(level)) {
    return res.status(400).json({ error: "level must be one of A1 A2 B1 B2 C1" });
  }
  res.json({ level: store.setLevel(level) });
});

app.get("/api/sources", (_req, res) => res.json(store.listSources()));

app.post("/api/sources", (req, res) => {
  const { type, title, url, content } = req.body || {};
  if (!String(content || "").trim() && !String(title || "").trim()) {
    return res.status(400).json({ error: "give the show something to work with: a title or some text" });
  }
  res.status(201).json(store.addSource({ type, title, url, content }));
});

app.delete("/api/sources/:id", (req, res) => {
  if (!store.removeSource(req.params.id)) return res.status(404).json({ error: "not found" });
  res.status(204).end();
});

app.get("/api/segments", (_req, res) => res.json(store.listSegments()));

// The heart of the station: hand back whatever airs next.
app.post("/api/next", wrap(async (req, res) => {
  const { position = 0, lastSourceId = null } = req.body || {};
  const slot = nextSlot({ position, lastSourceId });

  if (!slot) {
    return res.status(409).json({
      error: "The station has nothing to broadcast yet — send the show something first.",
    });
  }

  // Reruns are the whole point of a rotation: no generation, no cost, and the
  // listener meets the same vocabulary again a few slots later.
  if (slot.corner === "rerun" && slot.rerunOf) {
    store.markSegmentPlayed(slot.rerunOf.id);
    return res.json({ ...slot.rerunOf, corner: "rerun", label: slot.label, rerun: true });
  }

  const written = await writeSegment({
    corner: slot.corner,
    source: slot.source,
    level: store.getLevel(),
  });

  const saved = store.addSegment(written);
  store.markSegmentPlayed(saved.id);
  if (slot.source) store.markSourceAired(slot.source.id);

  res.json({ ...saved, label: slot.label, rerun: false });
}));

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  const { hasKey, model } = generationInfo();
  console.log(`\n  📻  Immerse FM is on the air at http://localhost:${port}`);
  console.log(hasKey ? `      writing scripts with ${model}` : `      no ANTHROPIC_API_KEY — running in mock mode`);
  console.log("");
});
