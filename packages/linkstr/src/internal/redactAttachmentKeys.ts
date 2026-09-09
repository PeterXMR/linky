import { Predicate, Struct } from "effect";

const isAttachment = (value: Record<string, unknown>): boolean =>
  typeof value["encryptionAlgorithm"] === "string" &&
  typeof value["key"] === "string" &&
  typeof value["nonce"] === "string";

const redactRecord = (value: Record<string, unknown>): unknown => {
  if (isAttachment(value)) return Struct.omit(value, "key", "nonce");
  let changed = false;
  const redacted: Record<string, unknown> = {};
  for (const [field, nested] of Object.entries(value)) {
    const next = redactAttachmentKeys(nested);
    if (next !== nested) changed = true;
    redacted[field] = next;
  }
  return changed ? redacted : value;
};

export const redactAttachmentKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    const redacted = value.map(redactAttachmentKeys);
    return redacted.every((next, index) => next === value[index])
      ? value
      : redacted;
  }
  if (Predicate.isRecord(value)) return redactRecord(value);
  return value;
};
