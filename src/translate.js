import { generateId } from "./ids.js";
import { config } from "./config.js";

// Claude Code sends its cheap background/classification calls on the Haiku
// tier. There's no other signal in the request to distinguish them, so we
// route by model name: anything mentioning "haiku" goes to SMALL_MODEL,
// everything else goes to BIG_MODEL.
export function pickModel(requestedModel = "") {
  return requestedModel.toLowerCase().includes("haiku")
    ? config.smallModel
    : config.bigModel;
}

function systemToOpenAI(system) {
  if (!system) return null;
  if (typeof system === "string") return system;
  return system
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n\n");
}

function toolResultToString(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return JSON.stringify(content);
  return content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

function imageBlockToOpenAI(block) {
  return {
    type: "image_url",
    image_url: { url: `data:${block.source.media_type};base64,${block.source.data}` },
  };
}

function convertUserMessage(content) {
  const parts = [];
  const toolMessages = [];

  for (const block of content) {
    if (block.type === "text") {
      parts.push({ type: "text", text: block.text });
    } else if (block.type === "image") {
      parts.push(imageBlockToOpenAI(block));
    } else if (block.type === "tool_result") {
      toolMessages.push({
        role: "tool",
        tool_call_id: block.tool_use_id,
        content: toolResultToString(block.content),
      });
    }
  }

  const messages = [];
  if (parts.length === 1 && parts[0].type === "text") {
    messages.push({ role: "user", content: parts[0].text });
  } else if (parts.length > 0) {
    messages.push({ role: "user", content: parts });
  }
  messages.push(...toolMessages);
  return messages;
}

function convertAssistantMessage(content) {
  let text = "";
  const toolCalls = [];

  for (const block of content) {
    if (block.type === "text") {
      text += block.text;
    } else if (block.type === "tool_use") {
      toolCalls.push({
        id: block.id,
        type: "function",
        function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) },
      });
    }
    // "thinking" / "redacted_thinking" blocks have no OpenAI equivalent.
  }

  const message = { role: "assistant", content: text || null };
  if (toolCalls.length > 0) message.tool_calls = toolCalls;
  return [message];
}

function convertMessage(msg) {
  if (typeof msg.content === "string") {
    return [{ role: msg.role, content: msg.content }];
  }
  if (msg.role === "user") return convertUserMessage(msg.content);
  if (msg.role === "assistant") return convertAssistantMessage(msg.content);
  return [{ role: msg.role, content: JSON.stringify(msg.content) }];
}

function convertTools(tools) {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    },
  }));
}

function convertToolChoice(toolChoice) {
  if (!toolChoice) return undefined;
  if (toolChoice.type === "auto") return "auto";
  if (toolChoice.type === "none") return "none";
  if (toolChoice.type === "any") return "required";
  if (toolChoice.type === "tool") {
    return { type: "function", function: { name: toolChoice.name } };
  }
  return "auto";
}

export function toOpenAIRequest(anthropicReq, model) {
  const messages = [];
  const system = systemToOpenAI(anthropicReq.system);
  if (system) messages.push({ role: "system", content: system });
  for (const msg of anthropicReq.messages) {
    messages.push(...convertMessage(msg));
  }

  const request = {
    model,
    messages,
    max_tokens: anthropicReq.max_tokens,
    temperature: anthropicReq.temperature,
    top_p: anthropicReq.top_p,
    stop: anthropicReq.stop_sequences,
    stream: Boolean(anthropicReq.stream),
    tools: convertTools(anthropicReq.tools),
    tool_choice: convertToolChoice(anthropicReq.tool_choice),
  };

  if (request.stream) {
    request.stream_options = { include_usage: true };
  }

  return request;
}

export function mapFinishReason(reason) {
  switch (reason) {
    case "length":
      return "max_tokens";
    case "tool_calls":
      return "tool_use";
    case "content_filter":
      return "end_turn";
    case "stop":
    default:
      return "end_turn";
  }
}

function safeParseJSON(text) {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

export function toAnthropicResponse(openaiResp, requestedModel) {
  const choice = openaiResp.choices[0];
  const msg = choice.message;
  const content = [];

  if (msg.content) content.push({ type: "text", text: msg.content });
  if (msg.tool_calls) {
    for (const call of msg.tool_calls) {
      content.push({
        type: "tool_use",
        id: call.id,
        name: call.function.name,
        input: safeParseJSON(call.function.arguments),
      });
    }
  }

  return {
    id: generateId("msg"),
    type: "message",
    role: "assistant",
    content,
    model: requestedModel,
    stop_reason: mapFinishReason(choice.finish_reason),
    stop_sequence: null,
    usage: {
      input_tokens: openaiResp.usage?.prompt_tokens ?? 0,
      output_tokens: openaiResp.usage?.completion_tokens ?? 0,
    },
  };
}

export function toAnthropicError(status, message) {
  return {
    type: "error",
    error: {
      type: status === 401 ? "authentication_error" : "api_error",
      message: typeof message === "string" ? message : JSON.stringify(message),
    },
  };
}
