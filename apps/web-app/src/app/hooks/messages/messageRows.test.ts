import {
  createId,
  directConversationIdFor,
  NonEmptyString,
  NonEmptyString100,
  NonEmptyString1000,
  OwnerId,
  PositiveInt,
  type ConversationRow,
  type MessageRow,
  type ReactionRow,
} from "@linky/linksync";
import { describe, expect, it } from "vitest";
import {
  contactIdByConversationId,
  localMessageFrom,
  normalizeLegacyLocalMessage,
  toLocalNostrMessage,
  toLocalNostrReaction,
  toMessagePatch,
  toMessageWriteRow,
  toReactionPatch,
  toReactionWriteRow,
} from "./messageRows";

const system = {
  ownerId: OwnerId.orThrow("AAAAAAAAAAAAAAAAAAAAAA"),
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  isDeleted: null,
};

const contactId = createId<"Contact">();
const conversationId = directConversationIdFor(contactId);

const messageRow = (overrides: Partial<MessageRow> = {}): MessageRow => ({
  id: createId<"Message">(),
  conversationId,
  direction: NonEmptyString100.orThrow("in"),
  content: NonEmptyString.orThrow("hello"),
  wrapId: NonEmptyString1000.orThrow("wrap-1"),
  rumorId: null,
  pubkey: null,
  createdAtSec: PositiveInt.orThrow(1_700_000_000),
  clientId: null,
  status: null,
  localOnly: null,
  replyToId: null,
  replyToContent: null,
  rootMessageId: null,
  editedAtSec: null,
  editedFromId: null,
  isEdited: null,
  originalContent: null,
  ...system,
  ...overrides,
});

describe("contactIdByConversationId", () => {
  it("maps through the conversation rows and derives the rest from the contacts", () => {
    const other = createId<"Contact">();
    const conversation: ConversationRow = {
      id: createId<"Conversation">(),
      kind: NonEmptyString100.orThrow("direct"),
      contactId: other,
      participantsJson: null,
      archivedAtSec: null,
      lastSeenAtSec: null,
      peerSeenSinceSec: null,
      peerSeenAtSec: null,
      ...system,
    };
    const map = contactIdByConversationId([conversation], [{ id: contactId }]);
    expect(map.get(conversation.id)).toBe(other);
    expect(map.get(conversationId)).toBe(contactId);
  });
});

describe("toLocalNostrMessage", () => {
  it("reads a row into the UI shape and drops one without a contact", () => {
    const row = messageRow({
      clientId: NonEmptyString1000.orThrow("client-1"),
      isEdited: NonEmptyString100.orThrow("1"),
      status: NonEmptyString100.orThrow("pending"),
    });
    expect(toLocalNostrMessage(row, contactId)).toMatchObject({
      id: row.id,
      contactId,
      direction: "in",
      content: "hello",
      clientId: "client-1",
      isEdited: true,
      status: "pending",
      localOnly: false,
    });
    expect(toLocalNostrMessage(row, undefined)).toBeNull();
  });
});

describe("failed status round trip", () => {
  it("keeps a failed message failed from write row to UI shape", () => {
    const written = toMessageWriteRow(
      createId<"Message">(),
      conversationId,
      {
        contactId,
        direction: "out",
        content: "never delivered",
        wrapId: "",
        rumorId: null,
        pubkey: "",
        createdAtSec: 1_700_000_002,
        status: "failed",
        localOnly: false,
        replyToId: null,
        replyToContent: null,
        rootMessageId: null,
        editedAtSec: null,
        editedFromId: null,
        isEdited: false,
        originalContent: null,
      },
      "pending:local-2",
    );
    expect(written?.status).toBe("failed");
    expect(toMessagePatch({ id: "m", status: "failed" })).toEqual({
      status: "failed",
    });
    const row = messageRow({
      direction: NonEmptyString100.orThrow("out"),
      status: NonEmptyString100.orThrow("failed"),
    });
    expect(toLocalNostrMessage(row, contactId)?.status).toBe("failed");
    expect(
      normalizeLegacyLocalMessage({
        contactId,
        direction: "out",
        content: "never delivered",
        status: "failed",
      })?.status,
    ).toBe("failed");
  });

  it("keeps a failed reaction failed from write row to UI shape", () => {
    const written = toReactionWriteRow(
      createId<"Reaction">(),
      conversationId,
      {
        messageId: "rumor-1",
        reactorPubkey: "pk",
        emoji: "👍",
        wrapId: "wrap-r",
        createdAtSec: 5,
        status: "failed",
      },
      "wrap-r",
    );
    expect(written?.status).toBe("failed");
    expect(toReactionPatch({ id: "r", status: "failed" })).toEqual({
      status: "failed",
    });
    const row: ReactionRow = {
      id: createId<"Reaction">(),
      conversationId,
      messageId: NonEmptyString1000.orThrow("rumor-1"),
      reactorPubkey: NonEmptyString1000.orThrow("pk"),
      emoji: NonEmptyString100.orThrow("👍"),
      wrapId: NonEmptyString1000.orThrow("wrap-r"),
      createdAtSec: PositiveInt.orThrow(5),
      clientId: null,
      status: NonEmptyString100.orThrow("failed"),
      ...system,
    };
    expect(toLocalNostrReaction(row)?.status).toBe("failed");
  });
});

describe("write rows", () => {
  it("builds a message row with the branded columns and omits what is absent", () => {
    const id = createId<"Message">();
    const row = toMessageWriteRow(
      id,
      conversationId,
      {
        contactId,
        direction: "out",
        content: "hi there",
        wrapId: "",
        rumorId: "rumor-1",
        pubkey: "",
        createdAtSec: 1_700_000_001,
        status: "pending",
        localOnly: true,
        replyToId: null,
        replyToContent: null,
        rootMessageId: null,
        editedAtSec: null,
        editedFromId: null,
        isEdited: false,
        originalContent: null,
      },
      "pending:local-1",
    );
    expect(row).toEqual({
      id,
      conversationId,
      direction: "out",
      content: "hi there",
      wrapId: "pending:local-1",
      createdAtSec: 1_700_000_001,
      status: "pending",
      rumorId: "rumor-1",
      localOnly: "1",
    });
  });

  it("rejects a message without content and a reaction without a target", () => {
    expect(
      toMessageWriteRow(
        createId<"Message">(),
        conversationId,
        {
          contactId,
          direction: "in",
          content: "   ",
          wrapId: "w",
          rumorId: null,
          pubkey: "",
          createdAtSec: 1,
        },
        "w",
      ),
    ).toBeNull();
    expect(
      toReactionWriteRow(
        createId<"Reaction">(),
        conversationId,
        {
          messageId: "",
          reactorPubkey: "pk",
          emoji: "x",
          wrapId: "w",
          createdAtSec: 1,
        },
        "w",
      ),
    ).toBeNull();
  });

  it("builds a reaction row", () => {
    const id = createId<"Reaction">();
    expect(
      toReactionWriteRow(
        id,
        conversationId,
        {
          messageId: "rumor-1",
          reactorPubkey: "pk",
          emoji: "👍",
          wrapId: "wrap-r",
          createdAtSec: 5,
          clientId: "c",
        },
        "wrap-r",
      ),
    ).toEqual({
      id,
      conversationId,
      messageId: "rumor-1",
      reactorPubkey: "pk",
      emoji: "👍",
      wrapId: "wrap-r",
      createdAtSec: 5,
      status: "sent",
      clientId: "c",
    });
  });
});

describe("patches", () => {
  it("decodes the named columns, keeps explicit nulls and drops empty text", () => {
    expect(
      toMessagePatch({
        id: "m",
        content: "edited",
        clientId: null,
        rumorId: "",
        status: "sent",
        editedAtSec: 12,
        isEdited: "1",
      }),
    ).toEqual({
      clientId: null,
      content: "edited",
      status: "sent",
      editedAtSec: 12,
      isEdited: "1",
    });
    expect(toReactionPatch({ id: "r", wrapId: "w2", status: "sent" })).toEqual({
      wrapId: "w2",
      status: "sent",
    });
  });
});

describe("local messages", () => {
  it("keeps the id and wrap a row got", () => {
    const local = localMessageFrom(
      {
        contactId,
        direction: "in",
        content: "x",
        wrapId: "",
        rumorId: null,
        pubkey: "",
        createdAtSec: 3,
      },
      "id-1",
      "pending:1",
    );
    expect(local).toMatchObject({ id: "id-1", wrapId: "pending:1" });
  });

  it("normalizes a legacy localStorage record and invents a wrap for one without", () => {
    const legacy = normalizeLegacyLocalMessage({
      contactId,
      direction: "out",
      content: "old",
      createdAtSec: "7",
    });
    expect(legacy?.wrapId.startsWith("legacy:")).toBe(true);
    expect(legacy?.createdAtSec).toBe(7);
    expect(normalizeLegacyLocalMessage({ direction: "out" })).toBeNull();
  });
});
