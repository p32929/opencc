import { generateId } from "./ids.js";
import { callId, stripThink } from "./textfix.js";

// Every model a provider offers is a candidate for every request. The name
// Claude Code asks for is ignored: it names Anthropic models, which say
// nothing about what the backends here can do, and the record in stats.jsonl
// answers that question better than a substring match ever did.
export function pickModels(requestedModel = "", provider) {
  // Parked models stay in the configured list — they just never get a turn.
  const off = provider.disabledModels ?? [];
  return off.length ? provider.models.filter((model) => !off.includes(model)) : provider.models;
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

// A PDF, in the shape OpenAI added for file input. Few OpenAI-compatible
// backends accept it, and that is the point: one that cannot will reject the
// request, which is recorded and routes around it.
//
// This used to be dropped on the floor. The model then answered confidently
// about a document it had never seen, which is worse than any error.
function documentBlockToOpenAI(block) {
  const source = block.source ?? {};
  const mediaType = source.media_type ?? "application/pdf";
  const data = source.type === "base64" ? `data:${mediaType};base64,${source.data}` : source.url;

  return {
    type: "file",
    file: { filename: block.title ?? "document.pdf", file_data: data },
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
    } else if (block.type === "document") {
      parts.push(documentBlockToOpenAI(block));
    } else if (block.type === "tool_result") {
      toolMessages.push({
        role: "tool",
        tool_call_id: callId(block.tool_use_id),
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

// Gemini 3.x issues a thought_signature alongside every function call and
// rejects any later turn that doesn't echo it back ("Function call is missing
// a thought_signature"). Anthropic's message format has nowhere to carry it,
// so remember it per tool-call id and re-attach it when that call comes back
// in the history. Scoped by provider: a signature minted by one backend is
// meaningless to another, and some reject unknown fields outright.
const toolExtras = new Map();
const MAX_TOOL_EXTRAS = 2000;

export function rememberToolExtra(id, extra, baseUrl) {
  if (!id || !extra) return;
  // Map keeps insertion order, so the first key is the oldest.
  if (toolExtras.size >= MAX_TOOL_EXTRAS) toolExtras.delete(toolExtras.keys().next().value);
  toolExtras.set(id, { extra, baseUrl });
}

function toolExtraFor(id, baseUrl) {
  const found = toolExtras.get(id);
  return found && found.baseUrl === baseUrl ? found.extra : undefined;
}

function convertAssistantMessage(content, baseUrl) {
  let text = "";
  const toolCalls = [];

  for (const block of content) {
    if (block.type === "text") {
      text += block.text;
    } else if (block.type === "tool_use") {
      const call = {
        // Nine letters and digits, which every provider takes; the same for
        // a call and its result, whenever they are sent.
        id: callId(block.id),
        type: "function",
        function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) },
      };
      const extra = toolExtraFor(block.id, baseUrl);
      if (extra) call.extra_content = extra;
      toolCalls.push(call);
    }
    // "thinking" / "redacted_thinking" blocks have no OpenAI equivalent.
  }

  const message = { role: "assistant", content: text || null };
  if (toolCalls.length > 0) message.tool_calls = toolCalls;
  return [message];
}

function convertMessage(msg, baseUrl) {
  // A system turn can arrive inside messages, not just in the top-level
  // system field: a SessionStart hook's output reaches Claude Code that way.
  // Its content is blocks, so it needs the same text extraction as the
  // top-level field rather than being stringified whole.
  if (msg.role === "system") {
    return [{ role: "system", content: systemToOpenAI(msg.content) ?? "" }];
  }
  if (typeof msg.content === "string") {
    return [{ role: msg.role, content: msg.content }];
  }
  if (msg.role === "user") return convertUserMessage(msg.content);
  if (msg.role === "assistant") return convertAssistantMessage(msg.content, baseUrl);
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

// baseUrl identifies which provider this request is being built for, so any
// remembered thought_signature is only replayed to the backend that issued it.
//
// can: what is known about the model, { vision, tools } (false: it is known not
// to). A model that cannot see images gets a note where the image was; one
// that cannot call tools gets none, and the tool turns already in the
// conversation as plain text. effort: a reasoning_effort to send.
export const NO_IMAGE_NOTE = "(an image was here, but this model can't see images)";
export function toOpenAIRequest(anthropicReq, model, baseUrl, stream = undefined, { can = {}, effort } = {}) {
  const messages = [];
  const systemParts = [];
  const system = systemToOpenAI(anthropicReq.system);
  if (system) systemParts.push(system);

  for (const msg of anthropicReq.messages) {
    for (const converted of convertMessage(msg, baseUrl)) {
      // vLLM rejects the whole request with "System message must be at the
      // beginning", so every system turn is folded into the single one at the
      // front instead of being left where it appeared in the history.
      if (converted.role === "system") {
        if (converted.content) systemParts.push(converted.content);
      } else {
        messages.push(converted);
      }
    }
  }

  if (systemParts.length > 0) {
    messages.unshift({ role: "system", content: systemParts.join("\n\n") });
  }

  // max_tokens is deliberately not forwarded. Anthropic requires it so Claude
  // Code always sends one (128000 as of Opus 5.5), but it's optional for
  // OpenAI-compatible backends and several reject a budget larger than their
  // own cap rather than just capping it — z.ai allows at most 98304. Leaving
  // it out lets each provider apply its own limit.
  const request = {
    model,
    messages,
    temperature: anthropicReq.temperature,
    top_p: anthropicReq.top_p,
    stop: anthropicReq.stop_sequences,
    // Forced false when streaming is switched off globally, even though the
    // client asked for one — the finished reply gets re-streamed instead.
    stream: stream === undefined ? Boolean(anthropicReq.stream) : Boolean(stream),
    tools: convertTools(anthropicReq.tools),
    tool_choice: convertToolChoice(anthropicReq.tool_choice),
  };

  if (request.stream) {
    request.stream_options = { include_usage: true };
  }
  if (effort) request.reasoning_effort = effort;

  if (can.vision === false) {
    for (const m of request.messages) {
      if (Array.isArray(m.content)) {
        m.content = m.content.map((p) => (p.type === "image_url" ? { type: "text", text: NO_IMAGE_NOTE } : p));
      }
    }
  }
  if (can.tools === false) {
    delete request.tools;
    delete request.tool_choice;
    request.messages = request.messages.map((m) => {
      if (m.role === "tool") return { role: "user", content: `(the result of your earlier tool call)\n${m.content}` };
      if (m.role === "assistant" && m.tool_calls) {
        const calls = m.tool_calls.map((c) => `(you called ${c.function.name} with ${c.function.arguments})`).join("\n");
        return { role: "assistant", content: [m.content, calls].filter(Boolean).join("\n") };
      }
      return m;
    });
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

export function toAnthropicResponse(openaiResp, requestedModel, baseUrl) {
  const choice = openaiResp.choices[0];
  const msg = choice.message;
  const content = [];

  // A model's own <think> block is its thinking, not its answer.
  const said = typeof msg.content === "string" ? stripThink(msg.content) : msg.content;
  if (said) content.push({ type: "text", text: said });
  if (msg.tool_calls) {
    for (const call of msg.tool_calls) {
      rememberToolExtra(call.id, call.extra_content, baseUrl);
      content.push({
        type: "tool_use",
        id: call.id,
        name: call.function.name,
        input: safeParseJSON(call.function.arguments),
      });
    }
  }

  // Reasoning models (gpt-oss, Gemini thinking) can spend the whole output
  // budget on reasoning and return no content at all. The Anthropic API never
  // replies with an empty content array, so fall back to the reasoning text
  // if there is any, and to an empty text block otherwise.
  if (content.length === 0) {
    content.push({ type: "text", text: typeof msg.reasoning === "string" ? msg.reasoning : "" });
  }

  return {
    id: generateId("msg"),
    type: "message",
    role: "assistant",
    content,
    model: requestedModel,
    // Same reasoning as the streaming path: a message carrying a tool_use block
    // must report "tool_use", whatever finish_reason the backend claimed.
    stop_reason: content.some((block) => block.type === "tool_use")
      ? "tool_use"
      : mapFinishReason(choice.finish_reason),
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
