import { randomBytes } from "node:crypto";

export function generateId(prefix) {
  return `${prefix}_${randomBytes(12).toString("hex")}`;
}
