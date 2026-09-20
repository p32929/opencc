# opencc

Lets you use [Claude Code](https://code.claude.com) for free (or cheap) by
connecting it to any **free or paid OpenAI-compatible API** — OpenRouter,
a local model, whatever — instead of paying for Anthropic's own API.

It works by running a tiny local server that sits between Claude Code and
your chosen AI provider, translating the conversation between them. Claude
Code doesn't know the difference.

## Why this exists

There are already a bunch of proxies out there that do basically this same
thing. Most of them do *way* too much: dozens of supported providers, admin
dashboards, multiple coding agents, messaging bot integrations, desktop
apps with tray icons — entire platforms, when all I actually wanted was one
small thing. I don't need 99 providers to use Claude Code for free. I just
wanted something simple that does exactly this, one job, and is easy enough
to set up that it takes a minute or two, not an afternoon of reading docs.
That's what opencc is — nothing more.

## How it works, step by step

### 1. Clone it

```bash
git clone https://github.com/p32929/opencc.git
cd opencc
```

### 2. Run it once to install

```bash
npm start
```

No `npm install` needed first — opencc has zero dependencies. This one
command makes the `opencc` command available anywhere on your computer, not
just inside this folder. You only ever run this once.

### 3. Set your config

```bash
opencc init
```

Run this from anywhere — you don't need to be inside the `opencc` folder.
It asks these questions, in order:

1. **`OpenAI-compatible base URL`** — your AI provider's address, e.g.
   `https://openrouter.ai/api/v1`
2. **`OpenAI-compatible API key`** — the key you got from that provider
3. **`Model for normal Sonnet/Opus-tier requests`** — the model that does
   the real work, e.g. `openai/gpt-4o`
4. **`Model for cheap Haiku-tier background requests`** — a smaller/cheaper
   model for quick background tasks. You can leave this blank to just reuse
   the model from the question above
5. **`Port`** — just press enter to accept the default (`3000`)

Your answers are saved so you won't be asked again. Run `opencc init` again
any time you want to change them.

### 4. Start the server

```bash
opencc
```

**Why this is needed:** Claude Code normally talks directly to Anthropic's
servers. opencc gives it a local server to talk to *instead* — this
command starts that server. It's what actually forwards your messages to
the AI provider you set up in step 3, and translates the response back.
Without this running, Claude Code has nothing to connect to.

Leave this terminal open — this is your server running.

### 5. Start Claude Code

Open a **second terminal** (leave the first one running), `cd` into the
project you want Claude Code to work on, and run:

```bash
opencc claude
```

Just like running `claude` normally, it works on whatever folder you're
in — so navigate to your project first, the same way you always would.
This launches Claude Code from there, pointed at the server from step 4
instead of Anthropic's real API.

Any of Claude Code's own flags work too — just add them after `claude`:

```bash
opencc claude --continue
opencc claude --resume
```

## Stopping it

Close both terminals (or `Ctrl+C`). Nothing runs in the background — opencc
only exists while those two commands are open.

## Changing your settings later

```bash
opencc init
```

Run it again any time, from anywhere. It shows your current values and
lets you update them.

## Good to know

- **Your API key never leaves your computer**, except to talk directly to
  the AI provider you picked. opencc's server only listens on your own
  computer — it's never reachable from your network.
- **If `opencc claude` says the server isn't running** — go do step 4 first.
- **If `opencc` says it's "not configured yet"** — go do step 3 first.
- **Two models, explained:** Claude Code normally uses a big model for real
  work and a small, cheap one for quick background tasks. opencc keeps that
  idea — whichever model you set as the "normal" one in step 3 does the real
  work; the "background" model (or the same one, if you left it blank)
  handles the small stuff.

## For developers running from a local clone

Prefer a project-local `.env` over `opencc init`? Copy `.env.example` to
`.env` and fill it in — it takes priority over the global settings
`opencc init` saves. `npm run server` starts just the server directly,
skipping the "are you configured?" check, useful for debugging.

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
