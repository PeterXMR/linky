import { Effect, Exit } from "effect";
import { Inspector } from "../inspector/Inspector";
import { inspectPlainOperation } from "./inspectPlainOperation";
import { inspectOperation } from "./operations";

it("does not inspect operation params when the inspector is disabled", async () => {
  let reads = 0;
  const params = {
    get draft() {
      reads += 1;
      return { content: "hello" };
    },
  };
  const program = Effect.gen(function* () {
    const inspector = yield* Inspector;
    const inspectWrapped = inspectOperation(
      inspector,
      "test.wrap",
      params,
      () => {
        throw new Error("A disabled inspector must not summarize receipts");
      },
    );
    const inspectPlain = inspectPlainOperation(inspector, "test.plain", params);
    expect(yield* inspectWrapped(Effect.succeed("sent"))).toBe("sent");
    expect(
      yield* inspectPlain(Effect.succeed({ result: "fetched", eventIds: [] })),
    ).toBe("fetched");
    expect(
      yield* Effect.exit(inspectWrapped(Effect.fail("send failed"))),
    ).toEqual(Exit.fail("send failed"));
    expect(
      yield* Effect.exit(inspectPlain(Effect.fail("fetch failed"))),
    ).toEqual(Exit.fail("fetch failed"));
  });

  await Effect.runPromise(Effect.provide(program, Inspector.disabled));
  expect(reads).toBe(0);
});
