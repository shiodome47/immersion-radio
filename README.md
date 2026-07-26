# 📻 Immerse FM

A personalized **i+1 immersion radio** for language learners.

You send the show material you actually care about — a YouTube transcript, a
meeting recording, a podcast, an article. Two AI hosts then talk about it to
each other, pitched just above your current level, and keep talking. You leave
it on.

Runs on Cloudflare Workers.

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
slots cost nothing to generate, and the station sounds more like a station. The
format clock has a dedicated rerun slot, so review is a corner of the show
rather than homework.

---

## The station is locked by default

This app stores whatever you send it. You are invited to send it your meeting
recordings, so a public URL with no lock on it would publish your work to
anyone who guesses the hostname — and let strangers spend your Anthropic
credits.

So there is a password gate — but nothing to configure before you can use it.
**The first person to open a freshly deployed station chooses its password**,
and setup closes permanently the moment it is used once. Until then the Worker
serves nothing private: a station mid-setup fails closed, not open.

`ACCESS_PASSWORD` still works as an override if you would rather set it as a
secret; doing so disables first-run setup and wins over any password already
claimed.

**If you forget the password**, setup will not simply let you claim it again —
that is what stops a stranger reclaiming a station they stumbled onto. Recovery
rides along with a deploy instead, which only the owner can do: change
`RESET_STATION` in `wrangler.toml` to any new string and push.

The token is consumed the first time a deploy carrying it serves a request, so
it clears the password exactly once and then does nothing on every later deploy.
That is why it is safe to leave in the file. The library survives — only the
password is cleared. Reload after the build and you are asked to choose a new
one.

`ACCESS_PASSWORD` set as a secret also overrides the stored password, if you
would rather manage it that way.

It is single-tenant on purpose: one password, one library, no accounts. This is
your station, not a service.

---

## Run it locally

```bash
npm install
cp .env.example .dev.vars     # set ACCESS_PASSWORD + SESSION_SECRET
npm run dev                   # http://localhost:8787
```

`SESSION_SECRET` can be anything long and random — `openssl rand -hex 32`.

Leave `ANTHROPIC_API_KEY` empty and the station still boots, playing canned mock
scripts so you can see the format working before spending anything.

Speech uses your **browser's built-in voice** — no TTS bill while you tune the
format. Works best in Chrome or Safari.

```bash
npm test    # the format clock's programming logic
```

## Deploy it

Deployment runs through **Cloudflare's Git integration** (Workers & Pages → your
project → Settings → Build), which runs `wrangler deploy` on every push.

**There is nothing to configure.** The station's storage is a Durable Object,
created automatically from the migration in `wrangler.toml`; the cookie-signing
key it generates for itself; and the password you set the first time you open
it. No namespace to provision, no secret to paste, no terminal.

The one optional secret is `ANTHROPIC_API_KEY`, under Settings → Variables and
Secrets. Without it the station plays canned mock scripts — the format works,
but your own material is never used, because writing the show is what the key
pays for. It is cheap: roughly $0.25 per hour of radio.

`.github/workflows/ci.yml` runs the tests on every push. It does not deploy —
that would double up with Cloudflare's integration.

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
station has enough history. `src/clock.js` is pure — it takes the data and
returns a decision — so the whole programming policy is covered by `npm test`
without KV, network, or a running Worker.

The listener-mail corner is not decoration. Material you submit *is* mail to the
show, so registering a source is an event inside the fiction rather than an
admin screen bolted to the side of it.

---

## Swapping in real voices

The browser voice is fine for judging structure and pacing, but it can't laugh,
and laughter is load-bearing here.

Everything downstream of `speakTurn()` in `public/app.js` is deliberately
swappable. Point it at a Worker route returning audio and nothing else changes.

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
src/
  index.js      Worker entry + API router
  auth.js       password gate, HMAC-signed session cookie
  clock.js      the format clock — pure, fully tested
  generate.js   the writers' room — two-host scripts, level-calibrated
  station.js    the Durable Object holding sources, segments, and level
public/         the receiver: lock screen, playback loop, transcript sync
test/           the clock's programming logic
```

`(laughs)` and friends are split out of the spoken text and shown in the
transcript only — the browser voice would read them aloud, which is worse than
silence. A real TTS backend should be passed them intact.

## Status

MVP. Verified against a local Worker with no configuration at all: first-run
setup claims the station and closes behind itself (a second attempt gets 409),
private routes 401 without a cookie, wrong passwords are rejected, plus the full
broadcast flow, Durable Object persistence across requests, corner selection and
its fallbacks, reruns, and static asset serving. Not verified: in-browser playback and voice assignment, which need a
real browser.

Not built yet: audio TTS, automatic YouTube fetching (paste is the intended
path), and comprehension tracking to infer your level from listening behaviour
rather than asking you.
