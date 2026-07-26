// Turns a user's source material into a short, spoken-English radio segment
// pitched just above the listener's current level ("i + 1" comprehensible input).
import Anthropic from "@anthropic-ai/sdk";

const MODEL = process.env.IMMERSE_MODEL || "claude-sonnet-5";

// CEFR guidance the host uses to calibrate difficulty. The target is always
// one notch ABOVE the listener's stated level — that's the "+1".
const LEVEL_GUIDE = {
  A1: "Listener is a near-beginner. Speak very simply and slowly, with short present-tense sentences and the ~1000 most common words. Introduce a few A2 words.",
  A2: "Listener is elementary. Use short, clear sentences and everyday vocabulary. Gently stretch toward B1 phrasing.",
  B1: "Listener is intermediate. Use natural conversational English with some connective phrases. Stretch toward B2: a few idioms and less common words, always explained in context.",
  B2: "Listener is upper-intermediate. Use fluent, natural spoken English with idioms and nuance. Stretch toward C1: richer vocabulary and more complex structures.",
  C1: "Listener is advanced. Use sophisticated, natural English. Stretch toward C2: precise, low-frequency vocabulary and subtle phrasing.",
};

const hasKey = () => Boolean(process.env.ANTHROPIC_API_KEY);

let client = null;
function getClient() {
  if (!client) client = new Anthropic();
  return client;
}

function buildPrompt({ source, level, station }) {
  const guide = LEVEL_GUIDE[level] || LEVEL_GUIDE.B1;
  const material = source.content
    ? source.content.slice(0, 6000)
    : `(No transcript was provided. Talk about the topic suggested by the title${
        source.url ? " and URL" : ""
      }.)`;

  return `You are the host of "Immerse FM", a personalized English immersion radio for a language learner.

# The listener
Current level: ${level}. ${guide}
This is comprehensible-input radio: every segment should be almost fully understandable, while pulling the listener slightly upward.

# This segment is based on the listener's own material
Type: ${source.type}
Title: ${source.title}
${source.url ? `URL: ${source.url}` : ""}
Material:
"""
${material}
"""

# Your job
Write ONE short radio segment (about 130-200 words of spoken English) where you, a warm and lively radio host, talk to the listener about this material. Requirements:
- Sound like real spoken radio: natural, friendly, first person, direct address ("you"). No headings, no bullet points, no stage directions.
- Recycle vocabulary and ideas FROM the material so it feels personal and relevant.
- Weave in 2-4 slightly-above-level words or phrases (the "+1"), each used naturally in a clear context so meaning is guessable.
- Do NOT define words mid-sentence like a textbook; keep the flow of speech. (The definitions go in the JSON field instead.)
- End with a one-line hook into what's coming up next on the station.
${station ? `- The station's current vibe: ${station}.` : ""}

# Output
Return ONLY valid JSON (no markdown fences) shaped exactly like:
{
  "title": "a short catchy segment title",
  "script": "the full spoken text of the segment",
  "newWords": [{ "word": "the word or phrase", "meaning": "a short, learner-friendly gloss" }]
}`;
}

// Fallback used when there's no API key — keeps the app demonstrable offline.
function mockSegment({ source, level }) {
  const snippet = (source.content || source.title || "your topic")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);
  const script =
    `You're listening to Immerse FM. Right now we're spending a little time with ` +
    `something you added yourself: "${source.title}". ` +
    (source.content
      ? `Here's the heart of it — ${snippet}${source.content.length > 220 ? "…" : ""} `
      : `We'll explore this topic together. `) +
    `Notice how the ideas connect, and don't worry about catching every single word. ` +
    `That's the whole point of immersion: you soak it in. ` +
    `Stay tuned — up next, we keep the stream going with more from your library.`;
  return {
    title: `Now playing: ${source.title}`,
    script,
    newWords: [
      { word: "soak it in", meaning: "absorb something gradually and comfortably" },
      { word: "stay tuned", meaning: "keep listening; more is coming" },
    ],
    mock: true,
    level,
    sourceId: source.id,
  };
}

function extractJson(text) {
  const trimmed = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("no JSON object in model output");
  return JSON.parse(trimmed.slice(start, end + 1));
}

export async function generateSegment({ source, level, station }) {
  if (!hasKey()) {
    return mockSegment({ source, level });
  }

  const message = await getClient().messages.create({
    model: MODEL,
    max_tokens: 1024,
    messages: [{ role: "user", content: buildPrompt({ source, level, station }) }],
  });

  const text = message.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  const data = extractJson(text);
  return {
    title: String(data.title || source.title),
    script: String(data.script || "").trim(),
    newWords: Array.isArray(data.newWords)
      ? data.newWords
          .filter((w) => w && w.word)
          .map((w) => ({ word: String(w.word), meaning: String(w.meaning || "") }))
      : [],
    mock: false,
    level,
    sourceId: source.id,
  };
}

export const generationInfo = () => ({ hasKey: hasKey(), model: MODEL });
