import { generateId } from "./ids.js";
import { mapFinishReason } from "./translate.js";

function sendEvent(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

// Reads an OpenAI-compatible SSE stream and re-emits it as an Anthropic
// Messages API SSE stream on `res`.
export async function streamOpenAIToAnthropic(upstream, res, requestedModel) {
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

  closeOpenBlocks();

  sendEvent(res, "message_delta", {
    type: "message_delta",
    delta: { stop_reason: mapFinishReason(finishReason), stop_sequence: null },
    usage: { output_tokens: outputTokens },
  });
  sendEvent(res, "message_stop", { type: "message_stop" });
  res.end();
}
