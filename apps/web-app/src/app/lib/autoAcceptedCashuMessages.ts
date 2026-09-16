import { Schema } from "effect";
import {
  safeLocalStorageGetJson,
  safeLocalStorageSetJson,
} from "../../utils/storage";

// Message ids whose cashu token the message-driven auto-accept has already
// resolved terminally — received, already known, or permanently spent. The
// in-session dedup ref forgets these on reload, and linkshu deliberately keeps
// a failed receive retryable, so without a persistent record a permanently
// spent token is re-attempted (and re-fails) on every launch. Only terminal
// outcomes are recorded; a transient mint failure stays retryable.
const STORAGE_KEY = "linky.cashu.auto_accepted_message_ids.v1";
const MAX_TRACKED_IDS = 1000;

const MessageIds = Schema.Array(Schema.String);

const read = (): readonly string[] =>
  safeLocalStorageGetJson(STORAGE_KEY, MessageIds, []);

export const isCashuAutoAcceptResolved = (messageId: string): boolean => {
  const id = messageId.trim();
  return id !== "" && read().includes(id);
};

export const markCashuAutoAcceptResolved = (messageId: string): void => {
  const id = messageId.trim();
  if (!id) return;
  const current = read();
  if (current.includes(id)) return;
  // Bounded FIFO: newest kept, oldest dropped.
  safeLocalStorageSetJson(
    STORAGE_KEY,
    [...current, id].slice(-MAX_TRACKED_IDS),
  );
};
