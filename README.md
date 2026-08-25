# opencc

**opencc** lets you use [Claude Code](https://code.claude.com) with almost
any AI model — not just Anthropic's own Claude models. That includes
OpenAI's models, OpenRouter (which gives you access to tons of models,
including free ones), or a model running on your own computer.

Claude Code normally only talks to Anthropic's servers. opencc runs quietly
in the background and translates the conversation both ways, so Claude Code
thinks it's talking to Claude, but it's really talking to whatever model you
picked.

It's kept intentionally small — no dashboard, no accounts to sign up for, no
extra apps. Just one small program that runs on your own computer.

## Before you start, make sure you have

1. **Node.js** (version 18 or newer). Check by typing `node -v` in your
   terminal. If that doesn't work, get it free from
   [nodejs.org](https://nodejs.org).
2. **Claude Code** installed. Check by typing `claude --version`. If you
   don't have it yet:
   ```bash
   npm install -g @anthropic-ai/claude-code
   ```
3. **An API key** from an AI provider. A couple of easy options:
   - [OpenRouter](https://openrouter.ai/keys) — one key gives you access to
     many different models, including some free ones.
   - [OpenAI](https://platform.openai.com/api-keys) — if you want to use
     OpenAI's own models directly.

## Step 1 — Get the code

```bash
git clone https://github.com/p32929/opencc.git
cd opencc
```

## Step 2 — Install it

```bash
npm start
```

This is the only install step, and you only run it once. It makes the
`opencc` command work from anywhere on your computer — not just inside this
folder. Once it finishes, you can leave this folder and never come back to
it; `opencc` will just work from now on.

## Step 3 — Tell opencc which AI model to use

```bash
opencc init
```

This asks a few simple questions, right in your terminal:

| Question | What to put |
|---|---|
| Base URL | The provider's web address. OpenRouter: `https://openrouter.ai/api/v1`. OpenAI: `https://api.openai.com/v1`. |
| API key | The secret key you got from that provider. |
| Model for normal requests | The model that does the real work, e.g. `openai/gpt-4o` (OpenRouter) or `gpt-4o` (OpenAI). |
| Model for background requests | A cheaper/faster model for small background tasks. You can leave this blank to just reuse the model above. |
| Port | Press Enter to accept the default (`3000`) unless you already have something else using that port. |

Here's what it looks like filled in, using OpenRouter as an example:

```
OpenAI-compatible base URL (e.g. https://api.openai.com/v1): https://openrouter.ai/api/v1
OpenAI-compatible API key: sk-or-v1-xxxxxxxxxxxxxxxxxxxxxxxxxxxx
Model for normal Sonnet/Opus-tier requests: openai/gpt-4o
Model for cheap Haiku-tier background requests (blank = same as above):
Port: 3000
```

Your answers are saved on your computer, so you won't need to type them
again. Want to change something later? Just run `opencc init` again — it
shows you what's already saved and lets you update just the parts you want.

## Step 4 — Start the proxy

Open a terminal and run:

```bash
opencc
```

Leave this terminal open — this is your proxy running, quietly translating
in the background. You'll see something like this:

```
opencc listening on http://localhost:3000

  Sonnet/Opus requests -> openai/gpt-4o
  Haiku requests       -> openai/gpt-4o

In another terminal, run: opencc claude
```

## Step 5 — Start Claude Code

Open a **second, separate terminal** (keep the first one open and running)
and type:

```bash
opencc claude
```

Claude Code opens exactly like it normally would — except now it's using
the model you chose in Step 3 instead of Anthropic's own Claude models.

Want to use Claude Code's own options, like `--continue`? Just add them
after `claude`:

```bash
opencc claude --continue
```

## When you're done

Close both terminals (or press `Ctrl+C` in each one). That's it — nothing
keeps running in the background. opencc only exists for as long as those
two commands are open.

## Changing your settings later

Run `opencc init` again, any time, from anywhere on your computer. It shows
you what's currently saved and lets you change just the parts you want.

## A couple of good-to-know details

- **Your API key stays on your computer.** opencc only ever sends it
  straight to the AI provider you picked in Step 3 — nowhere else. And
  opencc itself can only be reached from your own computer, never from
  other devices on your network.
- **"Sonnet/Opus" vs. "Haiku" models, explained:** Claude Code normally uses
  a big model for real thinking and a smaller, cheaper model for quick
  background tasks (like naming a conversation). opencc keeps that same
  idea — your "normal" model (from Step 3) handles the real work, and your
  "background" model (or the same one, if you left it blank) handles the
  small stuff.

## If something goes wrong

- **"opencc's proxy isn't running"** when you run `opencc claude` — you
  need `opencc` running in another terminal first (Step 4). This message
  tells you exactly that.
- **"opencc is not configured yet"** when you run `opencc` — run
  `opencc init` first (Step 3).
- **A port is already in use** — run `opencc init` again and pick a
  different port, like `3001`.

## For developers running from a local clone

If you'd rather keep settings inside this folder instead of using
`opencc init`, copy `.env.example` to `.env` and fill it in — a
project-local `.env` always takes priority over the global settings
`opencc init` saves. `npm run server` starts just the proxy directly
(bypassing the "are you configured?" check), handy for debugging.

## How model routing works, under the hood

Claude Code doesn't directly tell opencc whether a request is for the "big"
model or the "small" one — it just sends a model name. opencc looks at that
name: if it contains the word `haiku`, the request goes to your background
model; otherwise it goes to your normal model.
