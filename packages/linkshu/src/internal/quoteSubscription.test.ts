import { Mint, Wallet, WSConnection } from "@cashu/cashu-ts";
import { Effect, Fiber } from "effect";
import { QuoteId } from "../domain/primitives";
import { mintQuoteSocket } from "../testing/mintQuoteSocket";
import { recordingInspector } from "../testing/inspector";
import { awaitMintQuoteSettled } from "./quoteSubscription";

const settledStates: Array<"PAID" | "ISSUED"> = ["PAID", "ISSUED"];

vi.hoisted(async () => {
  const { WebSocket } = await import("ws");
  vi.stubGlobal("WebSocket", WebSocket);
});
afterAll(() => vi.unstubAllGlobals());

describe("mint quote socket lifetime", () => {
  it.each(settledStates)(
    "reconnects an acknowledged subscription and receives replayed %s",
    async (state) => {
      const server = await mintQuoteSocket();
      const wallet = new Wallet(new Mint(server.mint));
      const onClose = vi.spyOn(WSConnection.prototype, "onClose");
      const quoteId = QuoteId.make("quote-1");
      const inspector = recordingInspector();
      const fiber = Effect.runFork(
        awaitMintQuoteSettled(wallet, { mint: server.mint, quoteId }).pipe(
          Effect.provide(inspector.layer),
        ),
      );
      try {
        await vi.waitFor(() => {
          expect(
            wallet.mint.webSocketConnection?.activeSubscriptions,
          ).toHaveLength(1);
        });
        // Change state without a push, as if payment happened while disconnected.
        server.states.set(quoteId, state);
        server.disconnect();
        const result = await Effect.runPromise(
          Fiber.join(fiber).pipe(Effect.timeout("2500 millis")),
        );
        expect(result.state).toBe(state);
        expect(server.subscribedQuotes).toEqual([quoteId, quoteId]);
        expect(server.connections).toBe(2);
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(wallet.mint.webSocketConnection?.activeSubscriptions).toEqual(
          [],
        );
        await vi.waitFor(() => expect(server.openConnections).toBe(0));
        expect(inspector.events).toEqual([
          expect.objectContaining({
            _tag: "OperationFailed",
            name: "topup.subscribe",
            params: { mint: server.mint, quoteId },
            error: expect.objectContaining({
              _tag: "MintUnreachable",
              detail: expect.stringContaining("1006"),
            }),
          }),
        ]);
      } finally {
        await Effect.runPromise(Fiber.interrupt(fiber));
        await server.close();
        onClose.mockRestore();
      }
    },
  );

  it("reconnects only active subscribers on a shared socket", async () => {
    const server = await mintQuoteSocket();
    const wallet = new Wallet(new Mint(server.mint));
    const onClose = vi.spyOn(WSConnection.prototype, "onClose");
    const ids = [
      QuoteId.make("cancelled"),
      QuoteId.make("first"),
      QuoteId.make("second"),
    ];
    const fibers = ids.map((quoteId) =>
      Effect.runFork(
        awaitMintQuoteSettled(wallet, { mint: server.mint, quoteId }),
      ),
    );
    const [cancelled, ...active] = fibers;
    assert(cancelled !== undefined);
    try {
      await vi.waitFor(() => {
        expect(
          wallet.mint.webSocketConnection?.activeSubscriptions,
        ).toHaveLength(3);
      });
      await Effect.runPromise(Fiber.interrupt(cancelled));
      expect(wallet.mint.webSocketConnection?.activeSubscriptions).toHaveLength(
        2,
      );
      expect(server.connections).toBe(1);
      server.states.set("first", "PAID");
      server.states.set("second", "ISSUED");
      server.disconnect();
      const results = await Effect.runPromise(
        Effect.all(active.map(Fiber.join), { concurrency: "unbounded" }).pipe(
          Effect.timeout("2500 millis"),
        ),
      );
      expect(results.map((quote) => quote.state)).toEqual(["PAID", "ISSUED"]);
      expect(
        server.subscribedQuotes.filter((id) => id === "cancelled"),
      ).toHaveLength(1);
      expect(server.subscribedQuotes).toHaveLength(5);
      expect(server.connections).toBe(2);
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(wallet.mint.webSocketConnection?.activeSubscriptions).toEqual([]);
    } finally {
      await Effect.runPromise(Effect.forEach(fibers, Fiber.interrupt));
      await server.close();
      onClose.mockRestore();
    }
  });
});
