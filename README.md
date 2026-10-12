# opencc

Use [Claude Code](https://code.claude.com) with any OpenAI-compatible API
instead of paying Anthropic. A small local proxy sits in the middle. Claude
Code does not notice.

Zero dependencies. Add many free tiers and opencc finds which ones work.

![The opencc admin panel](PASTE_IMAGE_URL_HERE)

## Why

Other proxies do too much. Dozens of providers, dashboards, bot integrations,
desktop apps. I wanted one small thing that does one job and takes a minute to
set up. That is opencc.

## Setup

```bash
git clone https://github.com/p32929/opencc.git
cd opencc
npm start      # installs the `opencc` command - run once
```

Then use two terminals:

```bash
opencc         # leave it running
opencc claude  # cd to your project first
```

`opencc` starts two things:

```
  panel  http://localhost:3450
  proxy  http://localhost:9753   26 models, 5 providers
```

The **panel** is where you add providers. The **proxy** is what Claude Code
talks to. The proxy only starts when you have at least one provider with a
model. On a new install it waits, and starts by itself the moment you add one:

```
  panel  http://localhost:3450
  proxy  waiting - add a provider in the panel and it starts on its own
```

Use `--port` for the proxy and `--panel-port` for the panel. If a port is
busy, opencc uses the next free one.

Claude Code flags still work: `opencc claude --continue`.

![Claude Code running through opencc](PASTE_IMAGE_URL_HERE)

## How it works

All models from all providers go into one list. The order you type does not
matter.

Each request is filed by what it needed: **tools**, **image** or **document**
(and **text** for the rare request carrying none of them). opencc saves the
result of every call in `~/.opencc/stats.jsonl` - provider, model, kind,
status code.

It then picks a model with
[Thompson sampling](https://en.wikipedia.org/wiki/Thompson_sampling):

- Good record: picked often.
- Never tried: gets a fair chance.
- Bad record: picked rarely, but still tested sometimes.

So the work spreads over all models that answer. Five requests in a row usually
go to five different models.

Other rules:

- A model that fails at `image` keeps its good record for `text`.
- A request carrying a PDF goes only to models that have read one.
- A model that refused a smaller request for being too long is tried last for
  a bigger one.
- Old results count less. Half life is four days.
- A 429 or a timeout puts the model at the back for 15 to 60 seconds.
- If a model fails, the next one in the list is tried.
- 5xx: one retry. 4xx: move on.
- A 200 that came back empty, or with tool arguments nothing can parse, is
  not served. The next model is tried instead.
- A reply that starts and then dies counts against the model. It cannot be
  retried, because Claude Code already has half of it.
- Each refusal in a row doubles how long a model is left alone, up to an
  hour. One answer clears it.
- `max_tokens` is not sent. Some backends reject large values.

## Request size

Claude Code sends big requests. A model with a small window refuses one with a
400, which looks exactly like "this model is broken" unless you read the
message.

opencc reads it. The refusal is recognised as being about the request, not the
model, so it costs the model nothing in the record. What it does do is record
the size, which brackets the ceiling:

```
  maxOk       the largest request this model answered
  minTooBig   the smallest request it refused for length
```

The real limit is between the two, and the gap closes on its own as you use
it. No probing, no extra calls. Once a model has refused something, anything
that size or larger puts it at the back of the queue, behind even a
rate-limited model: the rate-limited one will work in a minute, this one never
will at this size.

Sizes are counted in characters, not tokens. Nothing here converts between the
two, so the unit only has to be the same on both sides of a comparison, and
characters are the one that can be measured without guessing.

## First run

A new install has no data, so opencc tests every model once before the proxy
starts. This takes about a minute.

```
  warming up 26 models across 5 providers
  z.ai glm flash GLM-4.6V-Flash      429  The service may be temporarily overloaded
  nvidia google/gemma-4-31b-it       403  Authorization failed
  24 of 26 answered, 24 called the tool

opencc on :9753 · 26 models · 5 providers

in another terminal: opencc claude
```

Models that already have data are skipped. Use `--no-warmup` to turn this off.

When you add a model or a provider in the panel, it is tested right away. You
do not need to restart the proxy: a running proxy reads the results from the
same file and starts using them. **Test new** in the panel does the same for
anything still untested.

![The warm-up on a fresh record](PASTE_IMAGE_URL_HERE)

## What Claude Code needs

Claude Code needs three things: tool calling, images you paste, and PDFs you
attach. If nothing in your pot can serve one of them, every request of that
kind fails, however many models you have.

The panel shows this at the top:

```
  Tool calling  23 models      Images  9 models      PDFs  7 models
```

Green means covered. Amber means not tested yet, with a button to test it.
Red means nothing can do it, and you need to add a model that can.

Tool calling is tested on first run, because nearly every Claude Code request
uses it. Images and PDFs are tested when you press their button.

The PDF test checks the model actually *read* the file, not just that it
accepted it. A model that takes a PDF and ignores it then answers confidently
about a document it never saw, which is worse than any error.

**Tool calling is required.** If every one of your models has been tried and
none can call tools, the proxy does not start at all:

```
  panel  http://localhost:3450
  proxy  not started - none of your 4 models can call tools
         Claude Code needs it to read and edit files.
         Add a model that can, in the panel, and it starts.
```

A model nobody has tried yet gets the benefit of the doubt, so a fresh install
still comes up. The proxy starts the moment one model passes, whether from a
warm-up, a **Test** button, or a real request.

**Images are optional.** Claude Code works fine without them, you just cannot
paste a screenshot. opencc says so once at startup and carries on.

## The panel

Open the panel URL that `opencc` prints. On a new install it opens by itself.

Each provider needs a base URL, an API key (can be empty), and a list of
models. Each model row shows its record: `text 100%  tools 24%  image -`.

| Button | What it does |
|---|---|
| Park | keep the model in the list, never call it |
| Remove | delete the model |
| Test | send one real request |
| Turn off | skip the provider, keep its key |
| Delete | remove the provider and its key |
| Streaming | off = wait for the full reply |
| Test new | test every model with no record yet |
| Text / Images Test | test what is still unknown for that kind |
| Reset record | forget all results |

## Reset

```bash
opencc --reset-stats
```

Forgets all results. Providers, models and keys stay. The old file is saved as
`~/.opencc/stats.jsonl.previous`.

## Config file

The panel writes `~/.opencc/.env`. A local `.env` overrides it. Providers
are numbered: first has no suffix, then `_2`, `_3`.

| Key | Meaning |
|---|---|
| `OPENAI_BASE_URL` | provider address |
| `OPENAI_API_KEY` | optional |
| `MODELS` | comma separated; order does not matter |
| `PROVIDER_NAME` | optional label |
| `PROVIDER_DISABLED` | `true` to skip it |
| `PROVIDER_MODELS_DISABLED` | models to skip, comma separated |
| `PORT` `STREAMING` | global settings |

Old configs with `BIG_MODEL` and `SMALL_MODEL` still work. Both become one
`MODELS` list.

## Tests

```bash
npm test                                 # offline, one second
OPENCC_E2E=1 node --test src/e2e.test.js # real API calls
```

## Changelog

### 3.0.0 - 2026-10-10

**Breaking**

- One `MODELS` list per provider. No more `BIG_MODEL` / `SMALL_MODEL` and no
  big/small tiers. Old configs are merged automatically.
- Capability detection removed, with `~/.opencc/capabilities.json`. opencc now
  learns what a model can do by using it.
- `opencc init --tui` removed. The browser panel is the only UI.
- `opencc init` and `opencc` are now one command. `opencc` serves the panel
  and the proxy. `opencc init` still works and does the same thing.

**Added**

- Routing by Thompson sampling over the saved results.
- Warm-up on first start, with live progress.
- Old results count less over time (four day half life).
- A 429 puts a model at the back for 15 to 60 seconds.
- `opencc --reset-stats` and a **Reset record** button.
- A coverage strip in the panel: how many models can do tool calling, images
  and PDFs, so a missing capability is visible before it breaks a session.
- The proxy does not start at all if every model has been tried and none can
  call tools.
- End-to-end tests against real providers.

**Fixed**

- The old ordering did nothing when every model was below 20%.
- Attempts cut short by the deadline counted as model failures, in the request
  walk and in the warm-up. The warm-up deadline was also a flat 180s, which cut
  the tail off a provider with many models.
- Adding a provider in the panel was impossible.
- The startup banner listed every provider and model. Now three lines.

### 2.0.0 — 2026-10-05

**Breaking**

- `POST /v1/messages/count_tokens` is gone. Claude Code copes — it falls back
  to its own estimate — but anything calling that route gets a 404.
- Module API changed, if you import from `src/`: `config.providers[]` replaces
  `config.bigModel` / `smallModel` / `openaiBaseUrl` / `openaiApiKey`;
  `pickModels()` replaces `pickModel()`; `toOpenAIRequest()` and
  `writeStoredConfig()` take different arguments.
- **Your existing `.env` keeps working** — it reads as provider 1.

**Added**

- Multiple providers, tried in order, with a priority list of models inside
  each. Automatic fallback when one is rate-limited, broke, or out of credits.
- `opencc init` is now an arrow-key menu: reorder, rename, enable/disable,
  edit and test providers in place.
- Disable a provider without deleting its key.
- Global streaming toggle, for backends with unreliable SSE.
- Config is re-read every request — no restarting the proxy after `opencc init`
  (except for `PORT`).
- Model testing runs six at a time instead of one after another.
- One retry on a 5xx before falling through to the next model.
- A timeout on upstream requests, so a provider that hangs can't hang you.
- `npm test` — a test suite, no dependencies.

**Fixed**

- A reply containing a tool call now always reports `stop_reason: tool_use`.
  Backends that reported plain `stop` made Claude Code treat the turn as
  finished and silently skip the tool.
- Gemini 3.x `thought_signature` is carried across turns, which that family
  requires — multi-turn tool use used to fail with a 500 on the second turn.
- Replies are never an empty `content` array. Reasoning models can spend their
  whole output budget thinking and return nothing visible.
- The API key is optional, for local backends that don't want one.
- `max_tokens` is no longer forwarded upstream. Claude Code has to send one
  (Anthropic requires it) and asks for 128000, which z.ai rejects outright —
  its cap is 98304. It's optional for OpenAI-compatible backends, so each
  provider now decides how long a reply to produce.
- Attempts are bounded: 5 minutes each, 10 minutes for the whole walk. There
  was no overall bound before, so a bad run could work through every model at
  10 minutes apiece, which looked like a hang rather than a failure.
- Failures are handled by status: a 5xx gets one retry on the same model, a 4xx
  moves straight to the next one.
- The request log shows the incoming size (`tools=`, `chars=`), which is what
  you need when a backend complains about length.
- `opencc init` opens a browser admin panel; `opencc init --tui` keeps the
  terminal menu.
- Capability-aware routing: opencc reads what a request needs and skips models
  that can't serve it, instead of failing through them. Capabilities come from
  a provider's published catalogue where there is one, and from differential
  probing otherwise.

### 1.0.2 — 2026-08-28

Model testing in `opencc init` became opt-in, and its timeout went from 15s to
300s for slow backends.

### 1.0.1 — 2026-08-26

`opencc init` sends a real request to each model before finishing, so a typo
in a URL, key or model name surfaces during setup instead of mid-session.

### 1.0.0 — 2026-08-25

First release. Single provider, Big and Small model, streaming and tool calls.

## Contributing

Contributions are warmly welcomed and greatly appreciated! Whether it's a bug fix, new feature, or improvement, your input helps make this project better for everyone.

Before submitting a pull request, please:

1. Create an issue describing the feature or bug fix you'd like to work on
2. Wait for discussion and approval to ensure alignment with project goals
3. Fork the repository and create your feature branch
4. Submit your pull request with a clear description of changes

This approach helps avoid duplicate efforts and ensures smooth collaboration. Thank you for considering contributing!

## Share

Sharing this repository with your friends is just one click away from here

[![facebook](https://user-images.githubusercontent.com/6418354/179013321-ac1d1452-0689-493f-9066-940cf2302b6e.png)](https://www.facebook.com/sharer/sharer.php?u=https://github.com/p32929/opencc/)
[![twitter](https://user-images.githubusercontent.com/6418354/179013351-7d8d6d1c-4ce2-46ab-bef8-4c4765a1b888.png)](https://twitter.com/intent/tweet?url=https://github.com/p32929/opencc/)
[![tumblr](https://user-images.githubusercontent.com/6418354/179013343-3111f55a-3b90-40c7-8487-9777348672b0.png)](https://www.tumblr.com/share?v=3&u=https://github.com/p32929/opencc/)
[![pocket](https://user-images.githubusercontent.com/6418354/179013334-b095c45f-becf-49f4-9ee1-5a731a9b1f85.png)](https://getpocket.com/save?url=https://github.com/p32929/opencc/)
[![pinterest](https://user-images.githubusercontent.com/6418354/179013331-44cd9206-11b1-4b65-becb-5863b61c828f.png)](https://pinterest.com/pin/create/button/?url=https://github.com/p32929/opencc/)
[![reddit](https://user-images.githubusercontent.com/6418354/179013338-7416ae3f-73ba-4522-86e1-1374d7082d22.png)](https://www.reddit.com/submit?url=https://github.com/p32929/opencc/)
[![linkedin](https://user-images.githubusercontent.com/6418354/179013327-ca7b7102-1da8-4b1c-858f-1a6e5f21bd70.png)](https://www.linkedin.com/shareArticle?mini=true&url=https://github.com/p32929/opencc/)
[![whatsapp](https://user-images.githubusercontent.com/6418354/179013353-f477fa0b-3e6f-4138-a357-c9991b23ff88.png)](https://api.whatsapp.com/send?text=https://github.com/p32929/opencc/)

---

## Support

If this saved you time, you can buy me a coffee — it keeps these projects maintained and free.

[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20me%20a%20coffee-%E2%98%95-FFDD00?style=for-the-badge&logo=buymeacoffee&logoColor=black)](https://www.buymeacoffee.com/p32929)

<!-- hire-block -->

---

## 💼 Need this customised — or need it yesterday?

I take fixed-price web & desktop work on my own projects. No hourly billing, no surprise scope:

| | |
|---|---|
| **Drop-in integration** — I wire this into your codebase and hand you a PR that builds | **$45** · 3 days |
| **Priority bug fix or small feature** — jumps ahead of the free issue queue | **$95** · 72 hours |
| **Custom build** — branded, packaged and deployed, source yours | **$130** · 7 days |
| **A full app from scratch** | **from $350** · quoted first |

All prices and how to buy → **[p32929.github.io/hire](https://p32929.github.io/hire/)**  
Or buy through [Fiverr](https://www.fiverr.com/fayazbinsalam) (escrow, ID-verified, 5.0★) — safest for a first job.

Scoping and quotes are free: [open an issue](https://github.com/p32929/hire/issues/new) and describe the job.

### Commercial use of this repo

This repo has **no license file**, which in copyright law means *all rights reserved*.
Personal use, learning and open-source forks: go ahead, just link back. Shipping it inside a
commercial or closed-source product needs a license — **$50** for one product, **$150**
company-wide and perpetual ([details](https://p32929.github.io/hire/)).
Rather not pay? [Ask in an issue](https://github.com/p32929/hire/issues/new) — I may just MIT it.
