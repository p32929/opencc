# Changelog


### 5.2.1 - 2026-11-16

From HeartCode's 0.1.63 to 0.1.67, the parts that pick and time models.

- **The pick is HeartCode's**: the first of your models (skipping one that has
  failed most of its recent work), then, after a failure, the best-ranked of the
  rest by LMArena's coding, web app, agent and hardest-prompt places moved by
  each model's track record, the unranked in your order (before, the next one
  down the list). See "How it works".
- **Track record** (`records.json`, on by default): replies and failures per
  model, fading with time; a poor model doesn't come first. A *poor* tag and a
  *Failing lately* state filter on Your models; Reset record clears it.
- **An error from a provider** (400 and above, 429 too) sends the next ask to
  another provider, as HeartCode does (before, only a refused key or an outage
  did).
- **Check models**: one button on Your models that fetches model info and the
  rankings, then tests the models shown (HeartCode 0.1.68).
- **Time limits set for free models**: a reply must start within 45 s (was 60),
  a started reply may go quiet for 60 s (was 150), a test waits a minute (was
  10) and never less than a reply may take to start; changing one moves the
  others that would contradict it and says so.

**Not copied from HeartCode 0.1.63 to 0.1.67**: helpers picked by job and
speed, the done tool, notifications, loops with steps in between, protected
`.heartcode` files, `--system-prompt` and `--logs` (an agent's work, not a
proxy's). *Keep trying when every model is busy* stays off by default:
HeartCode waits for an outage until you press Esc, but Claude Code retries a
failed request itself, and a proxy that holds it for up to ten minutes looks
frozen.

### 5.2.0 - 2026-11-10

- **Models are asked in your order**, top first, as in HeartCode (before, the
  order on the page meant nothing and a draw by the record decided). Sort a
  column and press **Save list** (always there), or tick some and **Move to the top**. The
  draw is still there as `PICK=record` / Behavior → Which model is asked first.
- **Config in HeartCode's format**: `~/.opencc/config.json`, so HeartCode's file
  can be copied in as it is, and test results in its `provider/model` form too.
  An old `.env` is read until the first save, then kept as
  `.env.before-config-json`.

- **Test results are kept** between restarts (`model-tests.json`), with their
  time on hover, so filtering by result works after a restart too.

From HeartCode's 0.1.43 to 0.1.62, the parts that belong in a proxy.

- **HTTP/1.1 requests** to providers, models.dev, the rankings and npm (see
  "When a model fails or is slow").
- **Stalled** is a setting now: how long a started reply may go quiet (60 s
  by default, 10 to 1800), kept at or above the start wait.
- **A stream cut short** is noticed, counted against the model and ended as
  `max_tokens`; the last line of a stream is read even without a line break.
- **Gemini's thinking**: with an effort set, Google's own Gemini is asked for
  its thoughts and the `<thought>` block is taken out of the reply, like
  `<think>`. A provider that refuses the field has it left out and learned.
- **Another version of a failed model** at the same provider goes to the back.
- **The tool-call check** in Test and Test all, shown in Works?.
- **Model lists** wait a minute rather than ten seconds, and a vLLM list that
  is a bare array is read.
- A test's reply preview no longer shows a model's thinking.
- **Your models fits the screen**: the model's name sits over its provider,
  tool calls, thinking and images are three letters in one **Can** column
  (the count is in the tooltip, and the column sorts by it), and everything is
  a little tighter. No sideways scrolling at 1280 px and wider.
- **Live updates heal themselves**: the panel's event stream now says
  something every twenty seconds. A page that hears nothing for a minute
  opens a new stream, and one that reconnects asks for what it missed
  (results, requests, the record) instead of waiting for the next event.

**Not copied from HeartCode 0.1.43 to 0.1.62**: the orchestrator and best-fit
pick (HeartCode removed them itself in 0.1.53), helpers, plans, reviews, page
checks and everything else about an agent's work, which a proxy does not do;
trying the best-ranked untried model next after a failure (opencc's order is
the record plus a small ranking tilt, and a failure should not undo that);
Tests-wait following Give up (opencc's ten-second test is a quick check and
lowering real work's wait from it would be a surprise).

### 5.1.2 - 2026-11-03

- README: thanks to Reika, OpenCode, Cline, OpenClaw and Pi.

### 5.1.1 - 2026-11-03

- README: a Thanks section (models.dev, LMArena, contributors).

### 5.1.0 - 2026-11-03

From HeartCode's 0.1.38 to 0.1.42, the parts that belong in a proxy.

**Added**

- **A reply must start**: a streamed reply is held until it has begun, so a
  model that never starts, errors inside a 200 or ends with nothing hands over
  to the next one (default 60 s, a setting). A stream that goes silent for 150
  s fails instead of hanging. Loops are cut. A tool call written out as text
  is not an answer.
- **Parts a model refuses are left out and learned**: `temperature`,
  `reasoning_effort`, `stream_options`, streaming, images and tool schemas,
  remembered per model for a day. Tool schemas are flattened for Gemini.
- **If a model fails** (Behavior): move on at once (the default), ask the same
  one again first up to N times, or retry nothing. `Retry-After` and Gemini's
  `retryDelay` are honoured and cool the model for as long as it asked.
  **Keep trying when every model is busy**, off by default.
- A provider whose key is refused, or that can't be reached, is not asked
  again through its other models until the others have had a turn.
- **Windows learned**: a refusal that states its limit, a silent cut, and a
  per-minute cap lower a model's window for a day, and a bigger request that
  works lifts it. Local servers (llama.cpp, LM Studio, Ollama, vLLM) are asked
  what window they run with. Sizes are estimated like a tokenizer, not
  characters ÷ 5.
- **Stay on the model that worked**: a conversation goes back to its model,
  so the provider's prompt cache holds. Off by default.
- **Public rankings** (LMArena): Coding, Web apps and Vision columns on Your
  models, and an optional small tilt of the draw. Fetched once a week.
- **Used and Spent** per model, from usage and the provider's or models.dev's
  price.
- **Reasoning effort** setting, including following Claude Code's thinking
  budget.
- **Update model info**: models.dev and the rankings in one click.
- The list holds still while models are tested.
- **Requests** shows the place in the walk, time to first words, tokens and
  cost; **Request log: Everything** keeps each request and reply.
- **Panel from other devices**, with a key; every request must name this
  machine, and a request from another site is refused.
- A newer opencc is announced in the panel and the terminal.

**Changed**

- Name matching against models.dev: `gpt-oss:120b` is `gpt-oss-120b`,
  `:free` and `-cloud` are dropped a part at a time, `-latest` is the newest
  dated version, and images count only if every provider that lists the model
  takes them.
- Tool call ids go out as nine letters and digits, as every provider takes.
  A model's own `<think>` block is no longer shown as its answer. A model that
  can't see images gets a note instead of the image.
- Changing the port no longer drops the ranking, timeouts and label from the
  config.

**Not copied from HeartCode**: it re-sends a model's reasoning to the model
that wrote it, which needs a reply format opencc doesn't have; opencc turns
thinking into nothing. Its separate log kinds don't apply to a proxy: there
is one request log, summary or full.

### 5.0.0 - 2026-11-02

**Added**

- **Reply label** (sidebar, `REPLY_TAG` in the config): puts a label such as
  `[groq-llama-3.3-70b]` in front of each reply, so Claude Code shows which
  model answered. Off by default: replies are untouched. The template takes
  `{provider}`, `{model}` and `{requested}`, and `\n` for a line break. Only
  the first text gets it (a reply that is only a tool call gets none), and the
  label is taken back off earlier replies in the conversation so a model
  does not learn to write it itself.
- Providers work like HeartCode's: unique names, per-provider list switch,
  Hello on a model or on the ticked ones, per-model setup with Measure, a
  provider's own list details (context, price, owner), and presets.
- Long lists are drawn a screenful at a time (redraw of 1,485 models: 140 ms
  to under 10 ms), and each provider's list keeps its scroll position.

**Changed**

- The panel edits one provider or model at a time on the server instead of
  posting the whole config, so two writers cannot wipe each other's models.
- Keys are masked and never sent to the page.
- Model lists are in `model-lists.json` (was `catalogues.json`).

### 4.1.0 - 2026-11-02

**Added**

- Ten filters on Your models, and **Keep only these N** to make the list you
  filtered to the list you keep. Everything that acts on "all" acts on what
  is shown.
- **From**, **Abilities** and **Thinking** columns, so a row says where its
  abilities come from rather than leaving you to guess from empty cells.
- Provider ranking: say which backends you prefer. It tilts the draw by at
  most 0.04 and cannot float a model that keeps failing.
- `TEST_LANES`, and `TEST_TIMEOUT` is now yours to set.

**Changed**

- models.dev is fetched once and kept, with everything it publishes rather
  than seven fields. It had a day's expiry, which meant re-downloading six
  megabytes to be told the same thing.
- Test runs happen on the server. The page used to drive them, and a browser
  holds six connections to one origin, so thirty-six lanes were six: 54
  models took 101s from the page against 8s from outside it.
- Test results show in the table as they land, with progress above it, and
  are kept between restarts, with the time each was taken.
- Provider model lists are kept on disk.

**Fixed**

- A column click sorts by that column instead of adding it under the others,
  where there were often no ties left to break and nothing appeared to
  happen.
- The progress strip threw on every update and died silently: the page held
  the right numbers and never drew them.
- A provider that answered 429 kept one lane for the rest of a run.
- Context read 1.1M for a 1,050,000-token window.
- The request log could grow without limit, and keeps 100 entries now.

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
- A request log: the last 100 requests with every model tried and what each
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
