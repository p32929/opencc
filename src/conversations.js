// Which model answered a conversation, so the next step goes there first.
//
// Every request is drawn afresh, which is right for spreading load and wrong
// for a conversation: a provider's prompt cache holds only for the model that
// has already read the conversation, and moving between models on every step
// pays for the whole conversation again each time. With "stay" on, a
// conversation goes back to the model that answered it while that model is
// available, and moves on, and stays on the new one, when it is not.
import { createHash } from "node:crypto";

const MAX = 500;
const TTL_MS = 3600_000;
const table = new Map();

// A conversation is known by how it began: its system prompt and its first
// message do not change as it grows.
export function conversationKey(anthropicReq) {
  const text = (c) => (typeof c === "string" ? c : JSON.stringify(c ?? ""));
  const first = (anthropicReq.messages ?? []).find((m) => m.role === "user");
  return createHash("sha1")
    .update(text(anthropicReq.system).slice(0, 400))
    .update("\u0000")
    .update(text(first?.content).slice(0, 2000))
    .digest("hex");
}

export function stickyFor(key, now = Date.now()) {
  const found = table.get(key);
  if (!found) return null;
  if (now - found.at > TTL_MS) {
    table.delete(key);
    return null;
  }
  return { baseUrl: found.baseUrl, model: found.model };
}

export function stick(key, baseUrl, model, now = Date.now()) {
  table.delete(key); // Map order is insertion order: the oldest is first
  table.set(key, { baseUrl, model, at: now });
  while (table.size > MAX) table.delete(table.keys().next().value);
}

export const forgetConversations = () => table.clear();
