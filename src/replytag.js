// An optional label put at the start of each reply, so Claude Code shows which
// provider and model answered, e.g. "[groq-llama-3.3-70b] Sure, ...". Off
// unless a template is set, and then it is the only thing that changes.
//
// The template takes {provider}, {model} and {requested} (the model name
// Claude Code asked for). A literal \n in it is a line break. With no break at
// the end, a space follows the label.
export const MAX_TAG = 200;

const FIELDS = ["provider", "model", "requested"];

const lineBreaks = (text) => text.replace(/\\n/g, "\n");

// The label for one reply, or "" when no template is set.
export function renderTag(template, { provider, model, requested }) {
  const text = String(template ?? "").trim();
  if (!text) return "";
  const values = { provider, model, requested };
  const out = lineBreaks(text.replace(/\{(\w+)\}/g, (all, k) => (FIELDS.includes(k) ? values[k] ?? "" : all)));
  return /\n$/.test(out) ? out : out + " ";
}

// The labels in earlier replies, taken back out of the conversation Claude
// Code sends again: a model that sees "[a-b] " on its own past answers copies
// it, and the label would be there twice.
export function stripTags(template, messages) {
  const text = String(template ?? "").trim();
  if (!text || !Array.isArray(messages)) return messages;

  const escaped = lineBreaks(text)
    .replace(/[.*+?^$()|[\]\\]/g, "\\$&")
    .replace(/\{(\w+)\}/g, (all, k) => (FIELDS.includes(k) ? "[^\\n]*?" : all.replace(/[{}]/g, "\\$&")));
  const re = new RegExp("^" + escaped + "(?:\\n|[ ])?");

  const strip = (s) => (typeof s === "string" ? s.replace(re, "") : s);
  return messages.map((m) => {
    if (m?.role !== "assistant") return m;
    if (typeof m.content === "string") return { ...m, content: strip(m.content) };
    if (!Array.isArray(m.content)) return m;
    return { ...m, content: m.content.map((b) => (b?.type === "text" ? { ...b, text: strip(b.text) } : b)) };
  });
}

// The same reply with the label in front of its first text.
export function tagMessage(message, tag) {
  if (!tag) return message;
  const content = [...message.content];
  const at = content.findIndex((b) => b.type === "text");
  if (at < 0) content.unshift({ type: "text", text: tag.trimEnd() });
  else content[at] = { ...content[at], text: tag + content[at].text };
  return { ...message, content };
}
