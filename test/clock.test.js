import { test } from "node:test";
import assert from "node:assert/strict";
import { nextSlot, CLOCK } from "../src/clock.js";

const source = (id, { airedCount = 0, createdAt = "2026-01-01T00:00:00Z" } = {}) => ({
  id,
  title: id,
  airedCount,
  createdAt,
});

const segment = (id, { corner = "main", playCount = 1, lastPlayedAt = "2026-01-01T00:00:00Z" } = {}) => ({
  id,
  corner,
  playCount,
  lastPlayedAt,
  newWords: [],
});

const WORDS = [{ word: "a" }, { word: "b" }, { word: "c" }];

test("an empty library has nothing to broadcast", () => {
  assert.equal(nextSlot({ position: 0, sources: [] }), null);
});

test("the clock walks its slots in order and wraps", () => {
  const sources = [source("s1"), source("s2")];
  const segments = [segment("g1")];

  const corners = Array.from({ length: CLOCK.length }, (_, i) =>
    nextSlot({ position: i, sources, segments, words: WORDS }).corner
  );

  assert.deepEqual(corners, CLOCK.map((s) => s.corner));

  // Position 7 is back to the top of the wheel.
  assert.equal(nextSlot({ position: 7, sources, segments, words: WORDS }).corner, "station_id");
});

test("corners with nothing to work with fall back to a main segment", () => {
  const sources = [source("s1", { airedCount: 1 })]; // nothing unaired -> no mail

  // No played segments -> nothing to rerun. Too few words -> no quiz.
  const bare = { sources, segments: [], words: [] };

  assert.equal(nextSlot({ position: 2, ...bare }).corner, "main", "quiz falls back");
  assert.equal(nextSlot({ position: 4, ...bare }).corner, "main", "mail falls back");
  assert.equal(nextSlot({ position: 5, ...bare }).corner, "main", "rerun falls back");
});

test("quiz needs at least three known words before it airs", () => {
  const sources = [source("s1")];
  const two = [{ word: "a" }, { word: "b" }];

  assert.equal(nextSlot({ position: 2, sources, segments: [], words: two }).corner, "main");
  assert.equal(nextSlot({ position: 2, sources, segments: [], words: WORDS }).corner, "quiz");
});

test("mail picks the newest thing that has never aired", () => {
  const sources = [
    source("fresh"),
    source("old", { airedCount: 3 }),
  ];
  const slot = nextSlot({ position: 4, sources, segments: [], words: [] });
  assert.equal(slot.corner, "mail");
  assert.equal(slot.source.id, "fresh");
});

test("main segments spread airtime to the least-aired source", () => {
  const sources = [
    source("hot", { airedCount: 5 }),
    source("cold", { airedCount: 0 }),
  ];
  assert.equal(nextSlot({ position: 1, sources, segments: [], words: [] }).source.id, "cold");
});

test("main segments avoid repeating the source that just aired", () => {
  const sources = [source("a"), source("b")];
  const slot = nextSlot({ position: 1, lastSourceId: "a", sources, segments: [], words: [] });
  assert.equal(slot.source.id, "b");
});

test("a single source still airs even when it just played", () => {
  const sources = [source("only")];
  const slot = nextSlot({ position: 1, lastSourceId: "only", sources, segments: [], words: [] });
  assert.equal(slot.source.id, "only");
});

test("reruns prefer the least-played segment, then the longest unheard", () => {
  const segments = [
    segment("played-twice", { playCount: 2, lastPlayedAt: "2026-01-05T00:00:00Z" }),
    segment("recent", { playCount: 1, lastPlayedAt: "2026-01-09T00:00:00Z" }),
    segment("stale", { playCount: 1, lastPlayedAt: "2026-01-02T00:00:00Z" }),
  ];
  const slot = nextSlot({ position: 5, sources: [source("s1")], segments, words: [] });
  assert.equal(slot.corner, "rerun");
  assert.equal(slot.rerunOf.id, "stale");
});

test("reruns never replay idents, other reruns, or anything unplayed", () => {
  const segments = [
    segment("ident", { corner: "station_id" }),
    segment("a-rerun", { corner: "rerun" }),
    segment("never-played", { playCount: 0 }),
  ];
  // Nothing eligible -> the slot degrades rather than airing an ident twice.
  assert.equal(nextSlot({ position: 5, sources: [source("s1")], segments, words: [] }).corner, "main");
});
