// The writers' room.
//
// Two hosts talking to each other is not just a nicer vibe than a monologue —
// it is the mechanism that makes i+1 work. A single narrator that wants to
// teach a hard word has to stop and define it, which turns radio back into a
// textbook. When one host rephrases or pushes back on the other, the same idea
// reaches the listener twice in different words and nobody breaks character.
//
// Calls the Anthropic API over plain fetch rather than the SDK, so this runs
// unchanged on Workers and in Node.

const API = "https://api.anthropic.com/v1/messages";

export const HOSTS = {
  A: {
    name: "Maya",
    persona:
      "warm, quick, curious. She is the listener's proxy: she interrupts to ask what a word means, " +
      "rephrases things in simpler terms, and says when she is lost. She laughs easily.",
  },
  B: {
    name: "Theo",
    persona:
      "dry, a bit nerdy, knows more about most topics and enjoys explaining. He gets carried away " +
      "and Maya reins him in. Occasionally he is stumped and has to admit it.",
  },
};

// The "+1": always aim one notch above where the listener is now.
const LEVEL_GUIDE = {
  A1: "Near-beginner. Very short present-tense sentences, the ~1000 most frequent words. Reach toward A2.",
  A2: "Elementary. Short clear sentences, everyday vocabulary. Reach toward B1 phrasing.",
  B1: "Intermediate. Natural conversational English with connective phrases. Reach toward B2: some idioms and less common words.",
  B2: "Upper-intermediate. Fluent natural speech with idiom and nuance. Reach toward C1: richer vocabulary, more complex structures.",
  C1: "Advanced. Sophisticated natural English. Reach toward C2: precise low-frequency vocabulary, subtle phrasing.",
};

const CORNER_BRIEF = {
  welcome: `The very first thing this listener ever hears (8-12 turns). The hosts introduce Immerse FM warmly, explain — in the flow of conversation, never as instructions — that the show is built from whatever the listener sends in, and coax them into sending the first thing. Speculate playfully about what it might be. Keep it light; they have not given you anything yet, so this is charm, not content.`,

  station_id: `A very short station ident (4-6 turns). The hosts welcome the listener to Immerse FM, riff briefly on nothing in particular, and tease what is coming up. Light and fast.`,

  main: `The main segment (14-20 turns). The hosts dig into the listener's material together: what it is actually saying, what surprised them, where they disagree. This is a real conversation, not a summary read aloud — they interrupt, build on each other, and go on small tangents before coming back.`,

  quiz: `The quiz corner (10-14 turns). The hosts quiz EACH OTHER on words and phrases that came up on the show earlier — never the listener directly, so nobody has to press a button. One asks, the other guesses, sometimes wrongly and funnily, then they land on the real meaning and use it in a fresh example sentence. The listener plays along in their head.`,

  mail: `The listener mail corner (10-14 turns). Treat the newly added material as a letter sent in to the show. The hosts read out what it is, react to it honestly (including if it is dry or strange), and pull one interesting thread out of it. Warm and a bit playful — this is the listener's own life on the radio.`,
};

function buildPrompt({ corner, source, level, words }) {
  const guide = LEVEL_GUIDE[level] || LEVEL_GUIDE.B1;

  const materialBlock = source
    ? `# The listener's material for this segment
Type: ${source.type}
Title: ${source.title}
${source.url ? `URL: ${source.url}` : ""}
${
  source.content
    ? `Transcript / text:\n"""\n${source.content.slice(0, 8000)}\n"""`
    : `(No transcript was supplied — work from the title${source.url ? " and URL" : ""}.)`
}`
    : "";

  const wordsBlock = words.length
    ? `# Vocabulary already introduced on the show
${words.map((w) => `- ${w.word} — ${w.meaning}`).join("\n")}
Recycle some of these naturally. Repetition across segments is how they stick.`
    : "";

  return `You are the writers' room for "Immerse FM", a personalized English immersion radio station made for one language learner.

# The two hosts
${HOSTS.A.name} (speaker A): ${HOSTS.A.persona}
${HOSTS.B.name} (speaker B): ${HOSTS.B.persona}
They have hosted together for years. They like each other. They talk over each other sometimes.

# The listener
Current level: ${level}. ${guide}
The target is roughly 90% comprehension: almost everything lands, and a little pulls them upward. This is passive listening — they are commuting or doing dishes. They cannot pause to look anything up, and they are never asked to respond.

${materialBlock}

${wordsBlock}

# This segment
${CORNER_BRIEF[corner] || CORNER_BRIEF.main}

# How to write it
- Real spoken English, not written English. Contractions, false starts, "I mean", "right?", "hang on".
- Short turns. Most should be one or two sentences. Let them cut each other off.
- Use nonverbal cues inline in parentheses where they genuinely happen: (laughs), (sighs), (pauses). Do not overdo it — a couple per segment.
- When a hard word appears, do not define it. Have the other host react to it, rephrase it, or ask about it. The meaning should be recoverable from the exchange alone.
- Introduce 2-4 slightly-above-level words or phrases (the "+1"). List them in newWords with plain glosses.
- No headings, no narration, no stage directions beyond the parenthetical cues.
- Never mention CEFR levels, "i+1", difficulty, or that this is a learning exercise. It is just a good radio show.
- End on a hook into whatever is next on the station.

# Output
Return ONLY valid JSON, no markdown fences, shaped exactly like:
{
  "title": "short catchy segment title",
  "turns": [
    { "speaker": "A", "text": "what Maya says" },
    { "speaker": "B", "text": "what Theo says" }
  ],
  "newWords": [{ "word": "the word or phrase", "meaning": "short learner-friendly gloss" }]
}`;
}

function extractJson(text) {
  const trimmed = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("no JSON object in model output");
  return JSON.parse(trimmed.slice(start, end + 1));
}

function normalize(data, { corner, source, level }) {
  const turns = (Array.isArray(data.turns) ? data.turns : [])
    .filter((t) => t && typeof t.text === "string" && t.text.trim())
    .map((t) => ({ speaker: t.speaker === "B" ? "B" : "A", text: t.text.trim() }));

  if (!turns.length) throw new Error("model returned no usable turns");

  return {
    corner,
    title: String(data.title || source?.title || "Untitled segment").trim(),
    turns,
    newWords: Array.isArray(data.newWords)
      ? data.newWords
          .filter((w) => w && w.word)
          .map((w) => ({ word: String(w.word).trim(), meaning: String(w.meaning || "").trim() }))
      : [],
    sourceId: source?.id || null,
    level,
    mock: false,
  };
}

// Offline fallback so the station is demonstrable before any key is set.
function mockSegment({ corner, source, level }) {
  const topic = source?.title || "your library";
  const canned = {
    welcome: [
      { speaker: "A", text: "You're listening to Immerse FM. I'm Maya." },
      { speaker: "B", text: "And I'm Theo. And right now — full disclosure — we have absolutely nothing to talk about." },
      { speaker: "A", text: "(laughs) That's not true. We have each other." },
      { speaker: "B", text: "That's worse, somehow." },
      { speaker: "A", text: "Here's the thing. This whole station runs on what you send us." },
      { speaker: "B", text: "A video you liked. A meeting you sat through. An article. Anything, really." },
      { speaker: "A", text: "Paste it in over there, and we'll take it from here." },
      { speaker: "B", text: "Please. I'm begging you. (laughs) We'll be right here." },
    ],
    station_id: [
      { speaker: "A", text: "You're listening to Immerse FM. I'm Maya." },
      { speaker: "B", text: "And I'm Theo. We've got a good one lined up." },
      { speaker: "A", text: "We do. Coming up — something you sent in yourself." },
      { speaker: "B", text: "Stick around. (laughs) Or don't, but you'll regret it." },
    ],
    quiz: [
      { speaker: "A", text: "Okay Theo, quiz time. What does it mean to circle back?" },
      { speaker: "B", text: "Ah — to return to something later. Usually in a meeting." },
      { speaker: "A", text: "Correct. Annoyingly correct." },
      { speaker: "B", text: "(laughs) I've sat through enough meetings to earn that one." },
    ],
    mail: [
      { speaker: "A", text: `We've got mail. Someone sent in "${topic}".` },
      { speaker: "B", text: "Oh, interesting. What made them pick that?" },
      { speaker: "A", text: "No idea. But that's what makes this fun." },
      { speaker: "B", text: "Let's dig in after this." },
    ],
  };
  const fallback = [
    { speaker: "A", text: `So today we're looking at "${topic}".` },
    { speaker: "B", text: "Right — and there's more going on here than you'd think." },
    { speaker: "A", text: "Say more?" },
    { speaker: "B", text: "(laughs) I thought you'd never ask." },
    { speaker: "A", text: "We'll pick this up after the break. Don't go anywhere." },
  ];
  const titles = {
    welcome: "Welcome to Immerse FM",
    quiz: "Quiz corner",
    mail: "Listener mail",
  };

  return {
    corner,
    title: titles[corner] || `Now playing: ${topic}`,
    turns: canned[corner] || fallback,
    newWords: [
      { word: "circle back", meaning: "return to a topic later" },
      { word: "stick around", meaning: "stay and keep listening" },
    ],
    sourceId: source?.id || null,
    level,
    mock: true,
  };
}

export async function writeSegment({ corner, source, level, words = [], env }) {
  if (!env?.ANTHROPIC_API_KEY) return mockSegment({ corner, source, level });

  const res = await fetch(API, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: env.IMMERSE_MODEL || "claude-sonnet-5",
      max_tokens: 4096,
      messages: [{ role: "user", content: buildPrompt({ corner, source, level, words }) }],
    }),
  });

  if (!res.ok) {
    throw new Error(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }

  const body = await res.json();
  const text = (body.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  return normalize(extractJson(text), { corner, source, level });
}
