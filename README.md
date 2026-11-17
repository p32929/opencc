# opencc

Run [Claude Code](https://code.claude.com) on any OpenAI-compatible API, including free and local models, instead of paying Anthropic. opencc is a small local proxy that sits between Claude Code and your providers. Claude Code does not notice the difference.

**Zero dependencies.** opencc uses only Node.js itself: nothing to `npm install` from anyone else, so there is no supply chain to attack. That matters for a proxy that sees your code and holds your API keys.

![The opencc admin panel](https://res.cloudinary.com/m0jnrul4/image/upload/v1793598151/aab0da67-5374-4260-870a-4bfb47787ebf.png)

## Why opencc

Other proxies try to do everything: dozens of providers, dashboards, bot integrations, desktop apps. I wanted one small thing that does one job well and takes a minute to set up.

1. **Use any OpenAI-compatible provider:** OpenRouter, Groq, Gemini, a local llama.cpp, LM Studio, Ollama or vLLM, all at once.
2. **Learns what actually works:** add many free tiers, and opencc keeps a track record of every model and sends each request to the ones that answer.
3. **Moves on when a model fails:** a rate limit, a timeout, an empty or broken reply hands the request to the next best model.
4. **Knows what each model can do:** context window, tools, images and price come from models.dev, and opencc learns the rest as it goes.
5. **A simple web panel** to add providers, pick and order models, test them, and see every request.
6. **Claude Code flags still work,** for example `opencc claude --continue`.

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
  opencc 4.1.0
  panel  http://localhost:3450
  proxy  http://localhost:9753   26 models, 5 providers
```

The **panel** is where you add providers and pick models. The **proxy** is
what Claude Code talks to. It starts as soon as there is a provider, and
starts by itself the moment you add one:

```
  opencc 4.1.0
  panel  http://localhost:3450
  proxy  waiting - add a provider in the panel and it starts on its own
```

Use `--port` for the proxy and `--panel-port` for the panel. If a port is
busy, opencc uses the next free one.

Claude Code flags still work: `opencc claude --continue`.


![Claude Code running through opencc](https://res.cloudinary.com/m0jnrul4/image/upload/v1793598199/Screenshot_2026-11-02_at_9.43.14_AM.png)

## How it works

All models from all providers go into one list, **Your models**, in the order
you save with **Save list**. This is HeartCode's way of picking, and the same
`config.json` works in both.

Each request is filed by what it needed: **tools**, **image** or **document**
(and **text** for the rare request carrying none of them). opencc saves the
result of every call in `~/.opencc/stats.jsonl` - provider, model, kind,
status code. Every request it serves is also logged to
`~/.opencc/requests.jsonl`, the last 100, which is what the Requests page
shows.

**Which model is asked**

1. The **first** is the first of your models, #1 on the page. If it has failed
   most of its recent work (its track record, below) it is skipped for the
   first of your models that has not.
2. When it fails, the next is **the best-ranked of the rest** (the best share of
   [LMArena](https://huggingface.co/datasets/lmarena-ai/leaderboard-dataset)'s
   coding, web app, agent and hardest-prompt rankings, so #5 of 200 beats #50
   of 200), not simply the next one down your list. A model that keeps doing
   well moves up and one that keeps failing moves down (its score x0.3 when it
   never failed, x1.7 when it always does); a model with a good record that
   isn't ranked comes before the other unranked; the unranked stay in your
   order.
3. Whatever cannot take the request goes behind all of them, each group in
   that same order: a model whose window is too small for it, one known not to
   do something it needs (tool calls, images), one that was just rate-limited
   or unreachable.
4. A provider that answered with an error (400 or above) is not asked again
   through its other models until the other providers have had a turn. When all
   have, what was held back goes in order.

**Track record** (`~/.opencc/records.json`, HeartCode's file and shape, on by
default, **Behavior** can switch it off): a whole reply counts as done; no
answer, a refused key, a plan needed or a server error counts against the
model (a rate limit does not, and neither does a request too big for it); a
reply that was empty, going round in circles, a tool call written out as text
or broken arguments counts half; one that died part way counts in full. Older
events fade, so a model that got better shows it. It needs about four recent
events before it says anything, and answers bring a model back.

The old way, Thompson sampling over the record in `stats.jsonl` (a good record
is picked often, a model never tried gets a fair chance, work spreads over
everything that answers), is **Behavior → Which model is asked first → A draw
by each model's record**, or `PICK=record`. The record in `stats.jsonl` still
decides the cool-offs below either way.

Other rules:

1. A model that fails at `image` keeps its good record for `text`.
2. A request carrying a PDF goes only to models that have read one.
3. A model that refused a smaller request for being too long is tried last for
  a bigger one.
4. Old results count less. Half life is four days.
5. A 429 or a timeout puts the model at the back for 15 to 60 seconds.
6. If a model fails, the next one is the best-ranked of the rest (above).
7. 5xx: one retry. 4xx: move on.
8. A 200 that came back empty, or with tool arguments nothing can parse, is
  not served. The next model is tried instead.
9. A reply that starts and then dies counts against the model. It cannot be
  retried, because Claude Code already has half of it.
10. Each refusal in a row doubles how long a model is left alone, up to an
  hour. One answer clears it.
11. `max_tokens` is not sent. Some backends reject large values.

When a model fails, what happens next is a setting (**Behavior** in the
sidebar). The default is what is described above. See
[When a model fails or is slow](#when-a-model-fails-or-is-slow).

## When a model fails or is slow

Everything here is learned or set, never assumed, and none of it is on by
default unless it says so.

**A reply must start.** A streamed reply is held until its first real chunk.
A model that doesn't start answering within **A reply must start within**
(default 45 s, 5 to 600), or answers with an error inside a 200, or ends the
stream with nothing in it, is passed over and the next model goes on, before
Claude Code has been sent anything. A keep-alive ping does not count as
starting. Once started, a stream that goes quiet for **A started reply may go
quiet for** (default 60 s, 10 to 1800, never less than the wait above: a
pause mid-reply has the same causes as a slow start) fails instead of hanging.

**A stream cut short.** A reply that closes with neither `[DONE]` nor a
reason for ending was cut by the connection. It is counted against the model
and ends as `max_tokens`, which Claude Code answers by asking the model to
carry on from there. A last line with no line break after it still counts.

**Another version of a model that failed** (`mistral-large-latest`, then
`mistral-large-2411`, at the same provider) would likely fail the same way: it
goes to the back with the held-back ones, and is still tried at the end.

**Requests go out over HTTP/1.1** (`http.js`), not Node's built-in `fetch`.
That one speaks HTTP/2 when a server offers it, and puts every request to a
host on one connection; when that connection dies without a word, every later
request waits on it and none is ever sent, which looked like every model
behind one gateway "not answering" for hours. Here each request has a socket
of its own, and one that is stopped takes its socket with it.

**A reply that loops** (the last 200 characters said six times within 12,000)
is cut and the model told to stop generating. What was sent can't be taken
back, so it counts against the model. A tool call written out as text (a chat
template's markup) is not an answer either: the next model is tried when
that's possible, and it counts against the model when it isn't.

**If a model fails**, by **If a model fails** in Behavior:

| Setting | What it does |
|---|---|
| Move on at once (default) | next model; a 5xx is asked again once |
| Ask the same one again first | for a rate limit, an outage or a timeout, up to **Tries of one model** (1 to 20), waiting as long as the provider said (`Retry-After`, or Gemini's `retryDelay`) |
| Move on, retry nothing | never asks one model twice |

A provider that answered with an error (400 or above, a 429 too) is not asked
again through its other models until the other providers have had a turn, as in
HeartCode; one that could not be reached at all gave no answer, so it isn't
held back (its cool-off and track record handle it). A 403 that is a web page
comes from a gateway and counts as an outage.

**Keep trying when every model is busy** (off by default) waits, then goes
round again until the ten-minute deadline or until Claude Code goes away,
instead of handing it the error. Only for failures waiting can fix.

**A part of the request a model refuses** (`temperature`, `reasoning_effort`,
`stream_options`, streaming, images, or tool schemas with `anyOf`) is left
out and the request sent again. If that works, it is remembered for that
model for a day (`~/.opencc/model-learned.json`). If it doesn't, the first
refusal stands and nothing is learned. Tool schemas are flattened to what
Gemini takes.

**Stay on the model that worked** (off by default): a conversation goes back
to the model that answered it while that model is available, so the
provider's prompt cache holds. A conversation is known by its system prompt
and first message.

**Reasoning effort** (default: nothing is sent): `low`, `medium`, `high`, or
follow Claude Code's thinking budget.

**Public rankings** (off by default): **Tilt the draw by public rankings**
adds a small bonus to models people rate higher on
[LMArena](https://huggingface.co/datasets/lmarena-ai/leaderboard-dataset)
for what the request needs: code always, agent work when tools are offered,
images when there are some, long input when it is long. It is a thumb on
the scale like your provider ranking, about a tenth at most; a model that
keeps failing still sinks. The rankings are fetched once a week in the
background into `~/.opencc/rankings.json`, and **Update model info** fetches
them again along with models.dev. The Coding, Web apps and Vision columns on
Your models always show them once fetched.

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

Sizes in the record are counted in characters. Against a model's window they
are counted in tokens, estimated the way tokenizers split text (a word or a
number is about one token, every symbol one), never below characters ÷ 4, and
scaled by the ratio learned from what each provider reports. Code, CSS and
JSON came out up to twice too low when it was a flat characters ÷ 3.5.

**Where a model's window comes from**, most trusted first:

1. what you set on its setup,
2. what **Measure** found (one oversized request: the server's error states
   its limit),
3. what the running server says: llama.cpp (`/props`), LM Studio, Ollama and
   Ollama Cloud (`/api/ps`, `/api/show`), vLLM and a `/models` list; asked
   once a day per model, when a request first goes to it,
4. models.dev's published window.

Then two things lower it, each for a day, and the table's tooltip says which:
a refusal that states its limit ("maximum context length is 131072"), or a
silent cut seen twice (Ollama beyond its `num_ctx` drops the start: far fewer
tokens counted than were sent); and a per-minute token cap, which is yours,
not the model's. A bigger request that works lifts a learned limit.

A model known not to call tools (models.dev, or you) is tried after the ones
that can for a request with tools; the same for images. A model that can't
see images gets a note where the image was, and one that can't call tools
gets the conversation's tool turns as plain text.

## What a model can do

Context window, price, tool calling, thinking, images and a dozen other
facts come from [models.dev](https://models.dev): 8,900 models, 23 fields
each. opencc fetches it once into `~/.opencc/models-dev.json` and keeps it.
There is no expiry — the **models.dev** button fetches it again when you
want it, and nothing else does.

opencc does not probe for any of this. There is no warm-up and no capability
test. A model it does not recognise just shows `?` and still gets its turn.

The published context window is used for routing too, but only where opencc
has learned nothing itself:

1. Already refused a request this size: skip it, whatever models.dev says.
2. Already answered one this size: the catalogue is wrong, ignore it.
3. Nothing known yet: trust the published window.

## The panel

Open the panel URL that `opencc` prints. On a new install it opens by itself.

**Providers** is every model your backends serve. Search across all of them,
filter to free, sort by name, price or context. Click a model to put it in the
pot, or tick several and add them together. Add one by name if the provider
does not list it.

**Your models** is what is in the pot, as one table: model, provider,
context, abilities, tools, thinking, images, price in and out, **From**,
record, tried and **Works?**. From says where a row's abilities come from —
models.dev, or "not found" when it has never heard of the name, which is the
answer to "why does this say it cannot call tools".

Click a column to sort by it; click again to reverse; shift-click to add one
under the sort you have, to break its ties.

Ten filters sit above it: search, provider, test result, tools, thinking,
images, how many abilities, context, price, whether models.dev knows it, and
whether it is in rotation, parked or switched off. Everything that acts on
"all" acts on what the filters show — **Test these 51**, **Take 51 out**,
and select-all ticks the rows you can see. **Keep only these N** turns the
list you are looking at into the list you keep.

**Requests** is what the proxy served: which models were tried, what each
answered, which one replied. Filter to failures or fallbacks.

| Button | What it does |
|---|---|
| Park | keep the model in the list, never call it |
| Test | send one real request; the result lands in Works? |
| Test all | a run on the server, which keeps going if you close the tab |
| Keep only these | drop everything the filters hide |
| Provider ranking | which providers you would rather use |
| Edit | a provider's URL, key, on/off, delete |
| Refresh | ask a provider for its model list again |
| models.dev | fetch the catalogue again |
| Streaming | off = wait for the full reply |
| Reply label | put `[provider-model]` (or your own) in front of each reply |
| Reset record | forget all results |

Testing runs on the server, every provider at once, **Test lanes** models at
a time from each. A provider that answers 429 drops to one lane, waits, and
its models go back on the queue — a rate limit is not a verdict on a model.
A model that has not answered within **Test timeout** (a minute by default, and never less than the time a reply may take to start) counts as a failure.
A model that says it calls tools (models.dev, or one nobody has described) is
also given a small job with one: a `write_file` tool and "create notes.txt
containing hello". It passes by calling it with those arguments. The Works?
cell then reads `✓ 1.2s · ✗ tools`, with why on hover, when it answers but
cannot do that; a model that fails that is a poor choice for Claude Code.

Each provider keeps its own model list in `~/.opencc/model-lists.json`, so
leaving the panel and coming back does not fetch them all again. Editing a
provider, or switching its list on or off, drops that provider's list. Test
results are kept in `~/.opencc/model-tests.json` with the time each was
taken, so a restart does not mean testing everything again. A run replaces the
result of every model it covers, and a provider that is edited loses its
models' results.

**Providers** works the way HeartCode's does. Each provider has a unique
name, an on/off switch and a list switch (off: only the models you add by
hand). **Test** on a model sends it "Hello" from the server and shows exactly
what was sent (key masked) and what came back; **Test** on ticked models does
it for all of them. A model's **setup** (its row in Your models) sets its
context window, tools, thinking, images and streaming above what models.dev
says, and **Measure** asks the server for its real window with one oversized
request. Keys never reach the page. Long lists are drawn a screenful at a
time, so thousands of models scroll smoothly.

Unlike HeartCode there is no hand-made order and no rotation rules: the order
comes from the record.

**Your models** also shows each model's **Coding**, **Web apps** and
**Vision** place in LMArena (the top tenth in green; hover for the score and
votes), what it has **Used** in tokens and what it has **Spent**, from the
provider's own figure or models.dev's price. **Update model info** fetches
models.dev and the rankings together. While a test run is going the list
holds still: filters and sorting wait, Stop still works.

**Requests** shows where in the walk the reply came from ("#2 of 3" is a
fallback), the time to the first words, tokens and cost. With **Request log**
set to *Everything* in Behavior, each request also keeps the whole request and
the reply (`~/.opencc/request-detail/`, removed after **Keep full requests
for** days, 3 by default). Those hold your conversation, so it is off by
default.

**Behavior** (sidebar) holds the settings above, plus **Panel from other
devices on your network**.

**Who can open the panel.** It answers this machine, with no key. Any request
must name this machine in its `Host` header, and a request made by a web page
from another site is refused. With **Panel from other devices** on, devices on
your private network can open it with the link opencc prints
(`http://192.168.x.x:3450/?t=...`); the key is in `~/.opencc/panel-key`, goes
into a cookie, and is taken out of the address bar. Off by default.

opencc checks npm for a newer version at each start. The panel says so in the
sidebar, and the terminal prints a line.

![Picking models](https://res.cloudinary.com/m0jnrul4/image/upload/v1793598232/19daf0e5-2e20-49d7-9cd2-f51f7ff5e127.png)

## Reset

```bash
opencc --reset-stats
```

Forgets all results. Providers, models and keys stay. The old file is saved as
`~/.opencc/stats.jsonl.previous`.

## Config file

The panel writes `~/.opencc/config.json`, in **HeartCode's own format**, so
you can copy HeartCode's `~/.heart/config.json` here (or the other way) and it
works as it is: the providers, your models, and the order they are asked in.

```json
{
  "providers": { "groq": { "baseUrl": "https://…", "apiKey": "…", "off": true, "list": false, "models": ["added-by-name"] } },
  "provider": "groq", "model": "openai/gpt-oss-20b",
  "rotation": { "on": "failure", "retries": 2, "next": "first",
                "then": [{ "provider": "mistral", "model": "mistral-large-4" }] },
  "testTimeout": 60, "replyStart": 45, "replyIdle": 60,
  "opencc": { "port": "9753", "behavior": { "pick": "record" } }
}
```

1. `provider` and `model` are the first of your models, `rotation.then` the
  rest. That is the order requests ask for them in. **Save list** on Your
  models writes the list as it is shown (always there; the sort and filters stay); a model that can't take the request or is cooling off
  goes behind the others, and a failure goes on to the next.
2. `off` switches a provider off, `list: false` stops asking it for its model
  list, `models` are the ones added by name.
3. `rotation.on` is `failure` or `retries` (ask the same one again first, up to
  `retries` times), as in HeartCode.
4. What only opencc has is under `opencc`: its port, `streaming: false`, the
  provider `rank`, `testLanes`, `replyTag`, `parked` models and the other
  behavior settings. Everything else in the file (HeartCode's status bar,
  Telegram…) is left as it is.
5. `model-tests.json` is HeartCode's format too (`"provider/model"` to its
  result), and `model-lists.json` is the same file.

An older `~/.opencc/.env` is read as it was until the first save, then it
becomes `config.json` and the old file is kept as `.env.before-config-json`.
A local `.env` in the folder you start in still overrides what it names.
These are the keys it takes, which are also what Behavior and the panel set:

| Key | Meaning |
|---|---|
| `OPENAI_BASE_URL` | provider address |
| `OPENAI_API_KEY` | optional |
| `MODELS` | comma separated |
| `PROVIDER_NAME` | optional label |
| `PROVIDER_DISABLED` | `true` to skip it |
| `PROVIDER_MODELS_DISABLED` | models to skip, comma separated |
| `PORT` `STREAMING` | global settings |
| `TEST_TIMEOUT` | seconds the panel's Test waits for a model, default 60, never under `REPLY_START` |
| `TEST_LANES` | models tested at once per provider, default 4 |
| `PROVIDER_RANK` | providers you prefer, best first, by base URL |
| `REPLY_TAG` | label put in front of each reply, e.g. `[{provider}-{model}]` |
| `PICK` | `order` (default): your order, top first; `record`: a draw by the record |
| `ON_FAIL` | `failure` (default), `retries` or `any` |
| `RETRIES` | tries of one model for `retries`, 1 to 20, default 2 |
| `REPLY_START` | seconds a streamed reply may take to start, default 45 |
| `REPLY_IDLE` | seconds a started reply may go quiet, default 60, never under `REPLY_START` |
| `TRACK_RECORD` | `off`: keep no track record and don't let it move a model (`trackRecord: false` in `config.json`) |
| `KEEP_TRYING` | `on`: when everything is busy, wait and go round again |
| `EFFORT` | `low`, `medium`, `high` or `follow`; default sends nothing |
| `BEST_FIT` | `on`: tilt the draw by public rankings |
| `STAY` | `on`: keep a conversation on the model that answered it |
| `LOG_DETAIL` | `full` keeps whole requests and replies; default `summary` |
| `LOG_DAYS` | days `full` detail is kept, default 3 |
| `PANEL_REMOTE` | `on`: panel answers other devices on your network, with its key |

Old configs with `BIG_MODEL` and `SMALL_MODEL` still work. Both become one
`MODELS` list.

## Tests

```bash
npm test                                 # offline, one second
OPENCC_E2E=1 node --test src/e2e.test.js # real API calls
```

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## Contributing

Contributions are very welcome, thank you! Before you start on a pull request, please open an issue and tell me what you would like to add or change. That way we can agree on it first, and your time is not wasted on something that might not fit. Thanks for helping make opencc better.

In a clone, `git config core.hooksPath .githooks` turns on a pre-commit hook (no packages) that bumps the patch version in `package.json` on every commit, unless the commit already changes it. `git commit --no-verify` skips it.

## Thanks

opencc leans on other people's work:

1. [models.dev](https://models.dev) (the SST team and its contributors) publishes the open catalogue of context windows, prices and abilities behind most of the panel.
2. [LMArena](https://lmarena.ai) publishes the public rankings (via its [Hugging Face dataset](https://huggingface.co/datasets/lmarena-ai/leaderboard-dataset)) behind the Coding, Web apps and Vision columns.
3. [Reika](https://github.com/alexwkleung/reika), [OpenCode](https://github.com/anomalyco/opencode), [Cline](https://github.com/cline/cline), [OpenClaw](https://github.com/openclaw/openclaw) and [Pi](https://github.com/earendil-works/pi): other coding agents whose use cases and findings taught me a lot of what a proxy like this has to handle.
4. Everyone who reported a bug, sent a pull request or starred the repository.

<p><a href="https://p32929.github.io/share/?repo=opencc"><picture><source media="(prefers-color-scheme: dark)" srcset="https://p32929.github.io/readme/footer-share-dark.svg"><img src="https://p32929.github.io/readme/footer-share-light.svg" width="50%" align="top" alt="Share this project with your friends in one click"></picture></a><a href="https://p32929.github.io/support/"><picture><source media="(prefers-color-scheme: dark)" srcset="https://p32929.github.io/readme/footer-support-dark.svg"><img src="https://p32929.github.io/readme/footer-support-light.svg" width="50%" align="top" alt="If you like my work and want to support me, feel free to support"></picture></a><br><a href="https://openstore.pfay.workers.dev/add"><picture><source media="(prefers-color-scheme: dark)" srcset="https://p32929.github.io/readme/footer-join-dark.svg"><img src="https://p32929.github.io/readme/footer-join-light.svg" width="100%" align="top" alt="Put your own apps on OpenStore: free, your listing lives in your own repo"></picture></a></p>
