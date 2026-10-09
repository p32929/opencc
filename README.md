# opencc

Use [Claude Code](https://code.claude.com) with any OpenAI-compatible API —
OpenRouter, Gemini, a local model — instead of paying for Anthropic's. A tiny
local proxy translates between them; Claude Code can't tell the difference.

Zero dependencies. Stack several providers and it falls back automatically
when a free tier runs dry.

![The opencc provider list](docs/screenshots/init-providers.png)

## Why this exists

There are already a bunch of proxies out there that do basically this same
thing. Most of them do *way* too much: dozens of supported providers, admin
dashboards, multiple coding agents, messaging bot integrations, desktop
apps with tray icons — entire platforms, when all I actually wanted was one
small thing. I don't need 99 providers to use Claude Code for free. I just
wanted something simple that does exactly this, one job, and is easy enough
to set up that it takes a minute or two, not an afternoon of reading docs.
That's what opencc is — nothing more.

## Setup

```bash
git clone https://github.com/p32929/opencc.git
cd opencc
npm start      # makes `opencc` available everywhere — run once
opencc init    # add your providers
```

Then two terminals:

```bash
opencc         # the proxy — leave it running
opencc claude  # cd to your project first
```

Claude Code's own flags pass straight through: `opencc claude --continue`.

## opencc init

```
  opencc — providers
  Tried top to bottom — if one fails, the next takes over.

❯ 1. work openrouter
    Big (Opus, Sonnet):  openai/gpt-4o, openai/gpt-5
    Small (Haiku):       openai/gpt-4o-mini
  2. my ollama
    Big (Opus, Sonnet):  llama3
    Small (Haiku):       llama3  (same as big)
  ────────────────────
  + Add provider      tried after the ones above
  Port                3000
  Streaming           on  replies arrive as they're generated
  Test all providers  sends "Hi" to each model
  ────────────────────
  Save and exit

  ↑↓ move · enter open · u/d reorder · space on/off · x delete · a add · q save
```

| Key | Does |
|---|---|
| `↑` `↓` | move the cursor |
| `enter` | open a provider / edit a field |
| `u` `d` | move this provider up / down the chain |
| `space` | turn this provider off / on |
| `x` | delete it (asks first) |
| `a` | add a provider |
| `t` | test every model · `p` change port |
| `q` `esc` | save and quit, or back out of anything |

**Big** models do the real work, **Small** models handle Claude Code's cheap
background calls (naming a conversation, classification). Comma-separate
either to get a priority list, tried left to right. Changes save immediately.

![Editing a provider](docs/screenshots/init-provider-detail.png)

- **Disable** (`space`) parks a provider that's out of credits — keeps its
  key and position, just skips it. Delete throws the key away.
- **Test** (`t`) sends one real "Hi" to every model, six at a time.
- **Streaming** off makes opencc wait for the full reply before passing it on.
  Worth trying if a backend's SSE is flaky.

![Testing every model](docs/screenshots/init-testing.png)

## Fallback

Providers are tried top to bottom, and each provider's models left to right.
Rate-limited, out of credits, down, unknown model — opencc moves to the next
combination and the request still goes through.

Model lists matter because free tiers throttle *per model*: when your first
choice starts 429ing, the next one on the same provider often still works.

```
[opencc]   attempt 1/3 (work openrouter, openai/gpt-4o) failed 429: rate limit exceeded
[opencc]   attempt 2/3 (work openrouter, openai/gpt-5) failed 429: rate limit exceeded
[opencc]   attempt 3/3 (my ollama, llama3) -> 200
```

![The startup banner](docs/screenshots/server-banner.png)

- **Retry same model** is per provider and **off by default**: a failure goes
  straight to the next model. Turn it on for a provider whose failures tend to
  be momentary and it gets one more try first. A settled 4xx (400/401/403/404)
  is never retried either way — there's nothing to gain.
- `max_tokens` is **not** forwarded. Anthropic requires it so Claude Code
  always sends one (128000 as of Opus 5.5), but it's optional upstream and
  several backends reject a budget bigger than their own cap instead of just
  capping it — z.ai allows at most 98304. Leaving it out lets each provider
  decide how long a reply to produce.
- The walk is bounded: 2 minutes per attempt, 5 minutes overall. Past that it
  returns the error instead of quietly working through the rest of the list.
- Failover only works *before* a reply starts arriving. If a provider dies
  mid-stream that one message fails; retry and the chain picks another.
- Config is re-read every request, so `opencc init` changes apply without
  restarting the proxy. Except **Port** — the socket is already bound.
- Your API key only ever goes to the provider you picked. The proxy listens
  on localhost only.

## Config file

`opencc init` writes `~/.opencc/.env`. A project-local `.env` overrides it
(copy `.env.example`). Providers are numbered — first unsuffixed, then `_2`,
`_3`:

| Key | Meaning |
|---|---|
| `OPENAI_BASE_URL` | the provider's address |
| `OPENAI_API_KEY` | optional — omit if the backend needs none |
| `BIG_MODEL` | comma-separated priority list, real work |
| `SMALL_MODEL` | comma-separated priority list, background work |
| `PROVIDER_NAME` | optional label; defaults to the host |
| `PROVIDER_DISABLED` | `true` to park it |
| `PROVIDER_RETRY` | `true` to retry the same model once before moving on (default off) |
| `PORT` `STREAMING` | global; `STREAMING=off` disables streaming |

`npm run server` runs the proxy alone; `npm test` runs the suite. Configs from
older single-provider versions still work — they read as provider 1.

![Claude Code running through opencc](docs/screenshots/claude-running.png)

## Changelog

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
- Attempts are bounded: 2 minutes each, 5 minutes for the whole walk. A bad
  run used to be able to sit on a 10-minute timeout per attempt, which looked
  like a hang rather than a failure.
- Retrying a failed model is now opt-in per provider and off by default, so a
  failure moves on immediately instead of doubling the wait.
- The request log shows the incoming size (`tools=`, `chars=`), which is what
  you need when a backend complains about length.

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
