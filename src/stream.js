import { generateId } from "./ids.js";
import { mapFinishReason, rememberToolExtra } from "./translate.js";

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
export async function streamOpenAIToAnthropic(upstream, res, requestedModel, baseUrl) {
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
    }

    const choice = chunk.choices?.[0];
    if (!choice) return;

    const delta = choice.delta ?? {};

    if (delta.content) {
      if (textBlockIndex === null) {
        textBlockIndex = nextIndex++;
        sendEvent(res, "content_block_start", {
          type: "content_block_start",
          index: textBlockIndex,
          content_block: { type: "text", text: "" },
        });
      }
      sendEvent(res, "content_block_delta", {
        type: "content_block_delta",
        index: textBlockIndex,
        delta: { type: "text_delta", text: delta.content },
      });
    }

    if (delta.tool_calls) {
      for (const call of delta.tool_calls) {
        let entry = toolBlocksByOpenAIIndex.get(call.index);
        if (!entry) {
          entry = {
            index: nextIndex++,
            id: call.id || generateId("toolu"),
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
        if (call.function?.arguments) {
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
  }

  const emittedToolUse = toolBlocksByOpenAIIndex.size > 0;

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
}
