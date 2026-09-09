import { ClientId, RetractionDraft, RumorId } from "@linky/linkstr";
import { stubWrapTransport } from "@linky/linkstr/testing";
import type { SignedWrapEvent } from "@linky/linkstr/testing";
import {
  linkstrConfigAtom,
  Registry,
  retractReactionAtom,
} from "@linky/linkstr-react";
import {
  configWith,
  makeIdentity,
  relayA,
  settle,
} from "@linky/linkstr-react/testing";
import { Exit } from "effect";
import { expect, it } from "vitest";

it("drives a linkstr-react atom with helpers imported through @linky/linkstr-react/testing", async () => {
  const alice = makeIdentity();
  const bob = makeIdentity();
  const registry = Registry.make();
  const published: Array<SignedWrapEvent> = [];
  registry.set(
    linkstrConfigAtom,
    configWith(alice, stubWrapTransport(published)),
  );

  registry.set(
    retractReactionAtom,
    new RetractionDraft({
      to: bob.pubkey,
      reactionIds: [RumorId.make("ab".repeat(32))],
      clientId: ClientId.make("client-42"),
    }),
  );
  const exit = await settle(registry, retractReactionAtom);

  expect(Exit.isSuccess(exit)).toBe(true);
  expect(published).toHaveLength(2);
  expect(registry.get(linkstrConfigAtom)?.writeRelays).toEqual([relayA]);
  registry.dispose();
});
