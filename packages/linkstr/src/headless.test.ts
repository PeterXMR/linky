import { Effect, Layer, Stream } from "effect";
import { getEventHash } from "nostr-tools";
import type { Event as NostrToolsEvent, Filter } from "nostr-tools";
import { RelayUrl, UnixSeconds } from "./domain/primitives";
import { runLinkstr } from "./headless";
import { InboxCursorStore } from "./inbox/InboxCursorStore";
import { NIP59_BACKDATE_MARGIN_SECONDS } from "./inbox/WrapInbox";
import { WrapInbox } from "./inbox/WrapInbox";
import { wrapRumorFor } from "./internal/giftWrap";
import { Rumor } from "./internal/nostrEvent";
import type { NostrTags } from "./internal/nostrEvent";
import { NostrTransport } from "./services/NostrTransport";
import type { NostrTransportService } from "./services/NostrTransport";
import { RelayPolicy } from "./services/RelayPolicy";
import { eventually, makeIdentity, stubStorage } from "./testing";

const alice = makeIdentity();
const bob = makeIdentity();

const relayA = RelayUrl.make("wss://relay-a.test");
const relayB = RelayUrl.make("wss://relay-b.test");

const chatWrap = () => {
  const fields = {
    pubkey: bob.pubkey,
    created_at: UnixSeconds.make(1_754_000_000),
    kind: 14,
    tags: [["p", alice.pubkey]] satisfies NostrTags,
    content: "hello",
  };
  const rumor = new Rumor({ ...fields, id: getEventHash(fields) });
  return wrapRumorFor(rumor, bob.secretKey, alice.pubkey);
};

const transportOf = (
  stored: ReadonlyMap<RelayUrl, ReadonlyArray<NostrToolsEvent>>,
): NostrTransportService => ({
  publish: () => Effect.succeed([]),
  subscribe: () => Effect.never,
  fetch: (relay) => Effect.succeed(stored.get(relay) ?? []),
});

const recordingSubscribeTransport = (
  filters: Array<Filter>,
): NostrTransportService => ({
  publish: () => Effect.succeed([]),
  subscribe: (_relay, filter) =>
    Effect.sync(() => {
      filters.push(filter);
    }).pipe(Effect.andThen(Effect.never)),
  fetch: () => Effect.succeed([]),
});

const scopedTransportOf = (
  service: NostrTransportService,
  lifecycle: Array<string>,
): Layer.Layer<NostrTransport> =>
  Layer.scoped(
    NostrTransport,
    Effect.acquireRelease(
      Effect.sync(() => {
        lifecycle.push("open");
        return service;
      }),
      () => Effect.sync(() => lifecycle.push("close")),
    ),
  );

describe("runLinkstr", () => {
  it("fetches a wrap through WrapInbox with a read-only relay policy", async () => {
    const wrap = chatWrap();

    const event = await runLinkstr(
      {
        secretKey: alice.secretKey,
        readRelays: [relayA],
        transport: Layer.succeed(
          NostrTransport,
          transportOf(new Map([[relayA, [wrap]]])),
        ),
      },
      Effect.flatMap(WrapInbox, (inbox) =>
        inbox.fetchWrapEvent(wrap.id, { extraRelays: [relayB] }),
      ),
    );

    expect(event).toEqual(
      expect.objectContaining({
        _tag: "ChatMessageReceived",
        from: bob.pubkey,
        body: expect.objectContaining({ _tag: "TextBody", text: "hello" }),
      }),
    );
  });

  it("defaults writeRelays to empty without failing eagerly", async () => {
    const writeRelays = await runLinkstr(
      {
        secretKey: alice.secretKey,
        readRelays: [relayA],
        transport: Layer.succeed(NostrTransport, transportOf(new Map())),
      },
      Effect.map(RelayPolicy, (policy) => policy.writeRelays),
    );

    expect(writeRelays).toEqual([]);
  });

  it("opens the scoped transport per run and closes it when the run ends", async () => {
    const lifecycle: Array<string> = [];
    const config = {
      secretKey: alice.secretKey,
      readRelays: [relayA],
      transport: scopedTransportOf(transportOf(new Map()), lifecycle),
    };
    const probe = Effect.as(WrapInbox, "done");

    await expect(runLinkstr(config, probe)).resolves.toBe("done");
    expect(lifecycle).toEqual(["open", "close"]);

    await runLinkstr(config, probe);
    expect(lifecycle).toEqual(["open", "close", "open", "close"]);
  });

  it("resumes the inbox from a supplied cursor store instead of since", async () => {
    const storage = stubStorage();
    const stored = UnixSeconds.make(1_756_000_000);
    storage.setItem("cursor", String(stored));
    const filters: Array<Filter> = [];

    await runLinkstr(
      {
        secretKey: alice.secretKey,
        readRelays: [relayA],
        inboxCursorStore: InboxCursorStore.fromStringStorage(storage, "cursor"),
        transport: Layer.succeed(
          NostrTransport,
          recordingSubscribeTransport(filters),
        ),
      },
      Effect.scoped(
        Effect.gen(function* () {
          const inbox = yield* WrapInbox;
          const feed = yield* inbox.open({
            since: UnixSeconds.make(1_755_000_000),
          });
          yield* Effect.forkScoped(Stream.runDrain(feed.events));
          yield* eventually(() => filters.length === 1);
        }),
      ),
    );

    expect(filters[0]?.since).toBe(stored - NIP59_BACKDATE_MARGIN_SECONDS);
  });

  it("rejects with the effect's typed failure", async () => {
    const wrap = chatWrap();

    const error = await runLinkstr(
      {
        secretKey: alice.secretKey,
        readRelays: [],
        transport: Layer.succeed(NostrTransport, transportOf(new Map())),
      },
      Effect.flatMap(WrapInbox, (inbox) => inbox.fetchWrapEvent(wrap.id)),
    ).then(
      () => null,
      (rejection: unknown) => rejection,
    );

    expect(String(error)).toContain("NoReadRelaysConfigured");
  });
});
