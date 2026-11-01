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
  opencc 4.0.0
  panel  http://localhost:3450
  proxy  http://localhost:9753   26 models, 5 providers
```

The **panel** is where you add providers and pick models. The **proxy** is
what Claude Code talks to. It starts as soon as there is a provider, and
starts by itself the moment you add one:

```
  opencc 4.0.0
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
status code. Every request it serves is also logged to
`~/.opencc/requests.jsonl`, the last 500, which is what the Requests page
shows.

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

## What a model can do

Context window, price, tool calling and images come from
[models.dev](https://models.dev). opencc caches the list for a day in
`~/.opencc/models-dev.json` and shows it per model in the panel.

opencc does not probe for any of this. There is no warm-up and no capability
test. A model it does not recognise just shows `?` and still gets its turn.

The published context window is used for routing too, but only where opencc
has learned nothing itself:

- Already refused a request this size: skip it, whatever models.dev says.
- Already answered one this size: the catalogue is wrong, ignore it.
- Nothing known yet: trust the published window.

## The panel

Open the panel URL that `opencc` prints. On a new install it opens by itself.

**Providers** is every model your backends serve. Search across all of them,
filter to free, sort by name, price or context. Click a model to put it in the
pot, or tick several and add them together. Add one by name if the provider
does not list it.

**Your models** is what is in the pot, as one table: model, provider, context,
tools, images, price in and out, record, tried. Click a column to sort;
click more columns to break ties. Shift-click to select a range.

**Requests** is what the proxy served: which models were tried, what each
answered, which one replied. Filter to failures or fallbacks.

| Button | What it does |
|---|---|
| Park | keep the model in the list, never call it |
| Test | send one real request, and show what was sent and received |
| Edit | a provider's URL, key, on/off, delete |
| Refresh | ask a provider for its model list again |
| models.dev | fetch the catalogue again |
| Streaming | off = wait for the full reply |
| Reset record | forget all results |

![Picking models](PASTE_IMAGE_URL_HERE)

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

### 4.0.0 - 2026-11-02

**Breaking**

- Capability probing is gone, and with it `src/warmup.js`, the three
  `/api/warmup` routes, the coverage strip and `--no-warmup`. What a model can
  do comes from models.dev. On a 27-model setup this took tool-calling probes
  from 27 to 2 and image probes from 27 to 2.
- The proxy no longer refuses to start unless something has proved it can call
  tools. That gate was the reason the probing existed. It starts as soon as
  there is something to route to.

**Added**

- models.dev: context window, price, tool calling and images, for 8,900+
  models, cached a day. Shown per model, and used as a size ceiling where
  opencc has learned none of its own.
- The dashboard is two pages. **Providers** lists everything your backends
  serve, searchable across all of them, filterable to free, sortable by name,
  price or context, with multi-select. **Your models** is one sortable table.
- A request log: the last 500 requests with every model tried and what each
  answered, filterable to failures or fallbacks, at `~/.opencc/requests.jsonl`.
- Live updates over SSE, a light/dark toggle, and a loading indicator on every
  network call.
- A provider with no models is kept, so you can add the backends first and
  pick models second. Requests then answer "Pick a model first".
- The version is printed on startup and in `--help`.
- **Test** shows exactly what was sent and what came back.

**Fixed**

- A system message arriving inside `messages`, which is how a SessionStart
  hook reaches Claude Code, was passed through where it sat. vLLM rejects any
  request whose system message is not first, so every call failed with
  "System message must be at the beginning". They are folded into the leading
  one now.
- The collapse arrow in the provider list was a button with no click handler,
  inside a header that ignores clicks on buttons, with a 9x15 hit area. Every
  click on it was thrown away.
- `/api/catalog/refresh` shipped with nothing calling it. It has a button now.
- A provider that refuses to list its models said nothing; it now says so
  instead of looking empty.

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

<!-- kit-block -->

---

## Using Claude Code CLI for real work?

I put together the **[Claude Code Starter Kit](https://p32929.github.io/claude-code-starter-kit/)** — tested `.claude/` subagents, slash commands and guard hooks (blocks `rm -rf` and `.env` reads) that install in 60 seconds. Free Lite version on GitHub, or the full kit plus a done-for-you Team ($999) / Enterprise ($1,499) rollout across your repos.

<!-- hire-block -->

---

## 💼 Using this at a company?

I do fixed-price delivery work on my own projects. One invoice, one date, no hourly billing:

| | |
|---|---|
| **White-label build** — this project rebranded, extended and deployed as yours | **$6,500** · 3 weeks |
| **Custom app from scratch** on my own stack, signed and auto-updating | **$12,500** · 6 weeks |
| **Production-hardening sprint** — 72 hours on this project, for your load and your security review | **$999** |
| **Ongoing capacity** — one project-week of my time reserved every month | **$9,000 / month** |

Full details → **[p32929.github.io/hire](https://p32929.github.io/hire/)** · Email **[fayazdevinbox@uberip.com](mailto:fayazdevinbox@uberip.com)** — scoping and quotes are free and I answer within one business day.

### Commercial use of this repo

This repo has **no license file**, which in copyright law means *all rights reserved*.
Personal use, learning and open-source forks: go ahead, just link back. Shipping it inside a
commercial or closed-source product needs a license — **$2,500** for one product, **$9,500**
company-wide and perpetual, signed and issued the same day
([details](https://p32929.github.io/hire/)).
