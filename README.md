# 📻 Immerse FM

A personalized **i+1 immersion radio** for language learners.

You send the show material you actually care about — a YouTube transcript, a
meeting recording, a podcast, an article. Two AI hosts then talk about it to
each other, pitched just above your current level, and keep talking. You leave
it on.

---

## Why two hosts

This is the core design bet, and it isn't only about atmosphere.

A single narrator has a problem: to teach a hard word, it has to stop and define
it, which instantly turns radio back into a textbook. Two hosts don't have that
problem. When Maya asks "wait, what does that mean?" and Theo rephrases it, the
same idea reaches you twice in different words — and nobody broke character.

Dialogue also gives you the English that monologue never does: interruptions,
backchannels, false starts, laughter, someone being stumped. That is the
register most learners never get enough of.

## Why it repeats itself

Real stations run **heavy rotation** — the same tracks come back around. That
isn't a flaw in radio, it's the format.

Here it does triple duty: repetition is how vocabulary actually sticks, rerun
slots cost nothing to generate, and the station sounds more like a station.
The format clock has a dedicated rerun slot, so review is a corner of the show
rather than homework.

---

## Run it

```bash
npm install
cp .env.example .env     # add your ANTHROPIC_API_KEY
npm start                # http://localhost:3000
```

Without an API key it still boots and plays canned mock scripts, so you can see
the format working before spending anything.

Speech uses your **browser's built-in voice** — no TTS bill while you tune the
format. Works best in Chrome or Safari.

## Use it

1. Paste a transcript into **Send the show something**. For YouTube, transcribe
   with [Notta](https://www.notta.ai/) (or anything similar) and paste the result.
2. Set your level. The show deliberately aims one notch above it.
3. Hit **Tune in**, and leave it running.

The station won't stop on its own. That's the point.

---

## The format clock

Every commercial station runs an hour template — it's what makes radio feel
endlessly fresh and reliably the same show. Immerse FM runs this one:

| Slot | Corner | What happens |
|---|---|---|
| 1 | Station ID | Short ident, teases what's coming |
| 2 | Main segment | The hosts dig into one of your sources |
| 3 | Quiz corner | They quiz **each other** on words from earlier |
| 4 | Main segment | A different source |
| 5 | Listener mail | Your newest submission, read out as a letter |
| 6 | Requested again | A past segment returns — spaced repetition |
| 7 | Main segment | Round the wheel again |

Corners degrade gracefully: with an empty library there's nothing to rerun and
no vocabulary to quiz, so those slots fall back to main segments until the
station has enough history.

The listener-mail corner is not decoration. Material you submit *is* mail to the
show, so registering a source is an event inside the fiction rather than an
admin screen bolted to the side of it.

---

## Swapping in real voices

The browser voice is fine for judging structure and pacing, but it can't laugh,
and laughter is load-bearing here.

Everything downstream of `speakTurn()` in `public/app.js` is deliberately
swappable. Point it at a server route returning audio and nothing else changes.

Rough costs, at ~1,000 characters ≈ 1 minute of speech:

| | per 1k chars | per hour | two-speaker dialogue |
|---|---|---|---|
| ElevenLabs Multilingual v3 | $0.180 | $8–12 | one call per speaker |
| **Gemini 3.1 Flash TTS** | **$0.012** | **$0.72–1.81** | **both hosts in one call** |
| Dia (Nari Labs, Apache 2.0) | self-host | GPU only | `[S1]`/`[S2]` + `(laughs)` |

Gemini is the recommended target: roughly 15× cheaper than ElevenLabs, renders
both hosts and the `(laughs)` cues in a single call, and bills by audio duration
— so a two-host show costs the same as a monologue. ElevenLabs is better at
extreme emotion, which a chat show doesn't need.

Script generation is a rounding error next to speech (~$0.25/hour), so there's
no reason to be stingy with the writing.

---

## Layout

```
server/
  index.js      Express app + API
  clock.js      the format clock — decides what airs next
  generate.js   the writers' room — two-host scripts, level-calibrated
  store.js      JSON-file persistence (sources, segment library, level)
public/
  index.html    the receiver
  app.js        playback loop, voice assignment, transcript sync
  styles.css
```

`(laughs)` and friends are split out of the spoken text and shown in the
transcript only — the browser voice would read them aloud, which is worse than
silence. A real TTS backend should be passed them intact.

## Status

MVP. Verified: the API, the clock's corner selection and fallbacks, rotation,
and module loading. Not yet verified: in-browser playback and voice assignment,
which need a real browser.

Not built yet: automatic YouTube fetching (paste is the intended path),
comprehension tracking to infer your level from listening behavior, and audio
TTS.
