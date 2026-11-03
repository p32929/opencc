import { generateId } from "./ids.js";
import { mapFinishReason, rememberToolExtra } from "./translate.js";
import { visible, loopStart, leakedMarkup } from "./textfix.js";

function sendEvent(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

// Emits an already-complete Anthropic message as an SSE stream. Used when
// streaming is switched off: the client still asked for a stream, so it still
// gets well-formed events — just all at once, after the whole reply arrived.
export function sendAnthropicAsStream(res, message) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  sendEvent(res, "message_start", {
    type: "message_start",
    message: { ...message, content: [], stop_reason: null, stop_sequence: null },
  });

  message.content.forEach((block, index) => {
    if (block.type === "text") {
      sendEvent(res, "content_block_start", {
        type: "content_block_start",
        index,
        content_block: { type: "text", text: "" },
      });
      sendEvent(res, "content_block_delta", {
        type: "content_block_delta",
        index,
        delta: { type: "text_delta", text: block.text },
      });
    } else if (block.type === "tool_use") {
      sendEvent(res, "content_block_start", {
        type: "content_block_start",
        index,
        content_block: { type: "tool_use", id: block.id, name: block.name, input: {} },
      });
      sendEvent(res, "content_block_delta", {
        type: "content_block_delta",
        index,
        delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input ?? {}) },
      });
    }
    sendEvent(res, "content_block_stop", { type: "content_block_stop", index });
  });

  sendEvent(res, "message_delta", {
    type: "message_delta",
    delta: { stop_reason: message.stop_reason, stop_sequence: message.stop_sequence ?? null },
    usage: { output_tokens: message.usage?.output_tokens ?? 0 },
  });
  sendEvent(res, "message_stop", { type: "message_stop" });
  res.end();
}

// Reads an OpenAI-compatible SSE stream and re-emits it as an Anthropic
// Messages API SSE stream on `res`.
export async function streamOpenAIToAnthropic(upstream, res, requestedModel, baseUrl, tag = "", { thinks = false, hadTools = false } = {}) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const messageId = generateId("msg");
  sendEvent(res, "message_start", {
    type: "message_start",
    message: {
      id: messageId,
      type: "message",
      role: "assistant",
      content: [],
      model: requestedModel,
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    },
  });

  let nextIndex = 0;
  let textBlockIndex = null;
  let tagged = false;
  // What the model has said so far, to take its own <think> block out of
  // what the client sees (it is shown from what it was after the block) and
  // to notice a reply that is going round in circles.
  let content = "";
  let emitted = "";
  let looped = null;
  const checked = new Map();
  const watch = (what, text) => {
    if (looped || text.length - (checked.get(what) ?? 0) < 2000) return;
    checked.set(what, text.length);
    const at = loopStart(text);
    if (at >= 0) looped = { what, at, sample: text.slice(-200).replace(/\s+/g, " ").trim().slice(0, 120) };
  };
  let cachedTokens = 0;
  let usageSeen = null;
  let firstAt = null;
  const toolBlocksByOpenAIIndex = new Map();
  let finishReason = "stop";
  let outputTokens = 0;
  let inputTokens = 0;

  function closeOpenBlocks() {
    if (textBlockIndex !== null) {
      sendEvent(res, "content_block_stop", { type: "content_block_stop", index: textBlockIndex });
      textBlockIndex = null;
    }
    for (const entry of toolBlocksByOpenAIIndex.values()) {
      sendEvent(res, "content_block_stop", { type: "content_block_stop", index: entry.index });
    }
    toolBlocksByOpenAIIndex.clear();
  }

  function handleChunk(chunk) {
    if (chunk.usage) {
      inputTokens = chunk.usage.prompt_tokens ?? inputTokens;
      outputTokens = chunk.usage.completion_tokens ?? outputTokens;
      cachedTokens = chunk.usage.prompt_tokens_details?.cached_tokens ?? cachedTokens;
      usageSeen = chunk.usage;
    }

    const choice = chunk.choices?.[0];
    if (!choice) return;

    const delta = choice.delta ?? {};

    if (delta.content) {
      firstAt ??= Date.now();
      content += delta.content;
      watch("content", content);
      // Only what is visible after the model's own <think> block, and only
      // the part not sent yet.
      const shown = visible(content, thinks);
      if (shown.startsWith(emitted) && shown.length > emitted.length) {
        const piece = shown.slice(emitted.length);
        emitted = shown;
        if (textBlockIndex === null) {
          textBlockIndex = nextIndex++;
          sendEvent(res, "content_block_start", {
            type: "content_block_start",
            index: textBlockIndex,
            content_block: { type: "text", text: "" },
          });
        }
        // The label goes in front of the first text, once.
        const text = tag && !tagged ? tag + piece : piece;
        tagged = true;
        sendEvent(res, "content_block_delta", {
          type: "content_block_delta",
          index: textBlockIndex,
          delta: { type: "text_delta", text },
        });
      }
    }

    if (delta.tool_calls) {
      for (const call of delta.tool_calls) {
        let entry = toolBlocksByOpenAIIndex.get(call.index);
        if (!entry) {
          entry = {
            index: nextIndex++,
            id: call.id || generateId("toolu"),
            name: call.function?.name || "",
            // Kept only so the finished call can be checked for being valid
            // JSON. The deltas themselves are forwarded as they arrive.
            argumentsText: "",
          };
          toolBlocksByOpenAIIndex.set(call.index, entry);
          sendEvent(res, "content_block_start", {
            type: "content_block_start",
            index: entry.index,
            content_block: { type: "tool_use", id: entry.id, name: call.function?.name || "", input: {} },
          });
        }
        // The thought_signature can arrive on any chunk of the call, not just
        // the one that opened it, so check every delta.
        if (call.extra_content) rememberToolExtra(entry.id, call.extra_content, baseUrl);
        if (call.function?.name) entry.name ||= call.function.name;
        if (call.function?.arguments) {
          entry.argumentsText += call.function.arguments;
          firstAt ??= Date.now();
          watch(`call ${call.index}`, entry.argumentsText);
          sendEvent(res, "content_block_delta", {
            type: "content_block_delta",
            index: entry.index,
            delta: { type: "input_json_delta", partial_json: call.function.arguments },
          });
        }
      }
    }

    if (choice.finish_reason) {
      finishReason = choice.finish_reason;
    }
  }

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop();

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") continue;
      try {
        handleChunk(JSON.parse(data));
      } catch {
        // Skip malformed chunks rather than killing the stream.
      }
    }

    // Going round in circles: stop it here. What has been sent cannot be
    // taken back, but the model is told to stop generating, and the reply
    // ends cleanly instead of running on to the limit.
    if (looped) {
      await reader.cancel().catch(() => {});
      break;
    }
  }

  const emittedToolUse = toolBlocksByOpenAIIndex.size > 0;
  const calls = [...toolBlocksByOpenAIIndex.values()].map((e) => ({ name: e.name, arguments: e.argumentsText }));
  // Arguments arrive as a string split across deltas. If the whole of it is
  // not JSON by the end, the tool call cannot be run.
  let badArguments = false;
  for (const block of toolBlocksByOpenAIIndex.values()) {
    const raw = block.argumentsText ?? "";
    if (raw === "") continue;
    try { JSON.parse(raw); } catch { badArguments = true; }
  }

  // Same reason as the non-streaming path: a reply that produced no blocks at
  // all (reasoning model that spent its whole budget thinking) would leave the
  // client with zero content blocks, which the Anthropic API never does.
  if (!emittedToolUse && textBlockIndex === null) {
    textBlockIndex = nextIndex++;
    sendEvent(res, "content_block_start", {
      type: "content_block_start",
      index: textBlockIndex,
      content_block: { type: "text", text: "" },
    });
  }

  closeOpenBlocks();

  // Anthropic always reports "tool_use" when the message contains a tool_use
  // block, and Claude Code relies on that to decide whether to run the tool —
  // "end_turn" makes it treat the turn as finished and silently drop the call.
  // Plenty of OpenAI-compatible backends send finish_reason "stop" (or omit it)
  // even while streaming tool calls, so trust the content over the upstream.
  const stopReason = emittedToolUse ? "tool_use" : mapFinishReason(finishReason);

  sendEvent(res, "message_delta", {
    type: "message_delta",
    delta: { stop_reason: stopReason, stop_sequence: null },
    usage: { output_tokens: outputTokens },
  });
  sendEvent(res, "message_stop", { type: "message_stop" });
  res.end();

  // What the reply actually contained, for the record. The caller cannot see
  // this: by the time the stream is done the bytes are already with Claude
  // Code and nothing is left to inspect.
  return {
    blocks: nextIndex, toolUse: emittedToolUse, badArguments,
    // A tool call written out as text, which Claude Code cannot run.
    garbled: hadTools && !emittedToolUse && Boolean(leakedMarkup(emitted)),
    looped: looped?.sample ?? null,
    usage: usageSeen && { input: inputTokens, output: outputTokens, cached: cachedTokens, cost: usageSeen.cost },
    firstMs: firstAt,
    text: emitted,
    calls,
  };
}

// Waits for the reply to start, before anything is promised to the client.
//
// A model that never starts answering, or answers with an error inside a 200
// stream, can still be given up on here and the next model asked: nothing has
// been written to Claude Code yet. Once the first real chunk has come, the
// stream is handed back with what was read put in front of it, and from then
// on a stream that goes silent for `idleMs` fails instead of hanging.
//
// Only a chunk with a choice in it counts as starting: a keep-alive ping or an
// empty frame while a provider queues the request does not.
export async function primeStream(upstream, { startMs = 60000, idleMs = 150000 } = {}) {
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();

  const readWithin = (ms, what) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reader.cancel().catch(() => {});
        reject(Object.assign(new Error(
          what === "start"
            ? `didn't start answering within ${Math.round(startMs / 1000)}s`
            : `sent nothing for ${Math.round(idleMs / 1000)}s`,
        ), { name: "TimeoutError", notStarted: what === "start" }));
      }, ms);
      reader.read().then(
        (r) => { clearTimeout(timer); resolve(r); },
        (e) => { clearTimeout(timer); reject(e); },
      );
    });

  const held = [];
  let buffer = "";
  let started = false;
  const until = Date.now() + startMs;

  while (!started) {
    const { value, done } = await readWithin(Math.max(1, until - Date.now()), "start");
    if (done) break;
    held.push(value);
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") continue;
      let chunk;
      try { chunk = JSON.parse(data); } catch { continue; }
      if (chunk.error) {
        // An error sent inside a 200 stream: its status from its code, else
        // a server error.
        const said = chunk.error.message ?? JSON.stringify(chunk.error);
        const code = Number(chunk.error.code ?? chunk.error.status);
        throw Object.assign(new Error(`server error: ${said}`), {
          status: code >= 400 && code < 600 ? code : 502, body: data, inStream: true,
        });
      }
      if (chunk.choices?.[0]) started = true;
    }
  }

  if (!started) {
    throw Object.assign(new Error("the stream ended without a reply"), { status: 502, empty: true });
  }

  let at = 0;
  return {
    body: {
      getReader: () => ({
        read: () => (at < held.length ? Promise.resolve({ value: held[at++], done: false }) : readWithin(idleMs, "idle")),
        cancel: () => reader.cancel(),
      }),
    },
  };
}
