# opencc

Lets you use [Claude Code](https://code.claude.com) for free (or cheap) by
connecting it to any **free or paid OpenAI-compatible API** — OpenRouter,
a local model, whatever — instead of paying for Anthropic's own API.

It works by running a tiny local server that sits between Claude Code and
your chosen AI provider, translating the conversation between them. Claude
Code doesn't know the difference.

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
It asks a few questions in your terminal:

- **Base URL** of your AI provider, e.g. `https://openrouter.ai/api/v1`
- **API key** for that provider
- **Model name** to use (and optionally a second, cheaper one for small
  background tasks)

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

Open a **second terminal** (leave the first one running) and run:

```bash
opencc claude
```

This launches Claude Code, pointed at the server from step 4, instead of
Anthropic's real API.

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
