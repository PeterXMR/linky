# Mints

`Mints` answers "what do I know about this mint" and "which mints does this wallet have state for". Use `info` for the mint settings page (name, fees, multi-part payment support, icon), `knownMints` when you need every mint the wallet has touched, and `addKnownMint` / `removeKnownMint` to manage that set by hand.

## Quick example

Prerequisites: a configured runtime ([getting-started.md](./getting-started.md)); `info` needs the mint reachable, `knownMints` works offline.

Two fields need their units first. `inputFeePpk` is the mint's cashu input fee in parts per thousand per proof spent: spending 10 proofs at 100 ppk costs 1 sat. `supportsMpp` says the mint accepts multi-part Lightning payments (NUT-15), so one invoice can be paid in parts from several mints.

```ts
import { Effect } from "effect";
import { Mints, parseMintUrl } from "@linky/linkshu";
import type { MintUrl } from "@linky/linkshu";

const describeMint = (raw: string) =>
  Effect.gen(function* () {
    const mint = parseMintUrl(raw);
    if (mint === null) return null;
    const mints = yield* Mints;
    const info = yield* mints.info(mint);
    const fee =
      info.inputFeePpk === null ? "unknown" : `${info.inputFeePpk} ppk`;
    return `${info.name ?? info.url}: input fee ${fee}, multi-part payments ${info.supportsMpp ? "yes" : "no"}`;
  });

const listMints: Effect.Effect<
  ReadonlyArray<MintUrl>,
  never,
  Mints
> = Effect.flatMap(Mints, (mints) => mints.knownMints);

const forgetMint = (raw: string) =>
  Effect.gen(function* () {
    const mint = parseMintUrl(raw);
    if (mint === null) return "not a mint url";
    const mints = yield* Mints;
    return yield* mints.removeKnownMint(mint).pipe(
      Effect.as("forgotten"),
      Effect.catchTag("MintInUse", (inUse) =>
        Effect.succeed(`still holds ${inUse.rowCount} token rows`),
      ),
    );
  });
```

Always go through `parseMintUrl` (or `MintUrl.make` on already-normalized input): the package compares mints by their normalized form without a trailing slash, and two spellings of one mint would fork its counters.

## How it works

`info(mint)` loads the mint's published info (NUT-06), keysets, and keys, and returns a `MintInfo` (`mint/domain.ts`):

| Field             | Type                                                   | Meaning                                                                                                      |
| ----------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `url`             | `MintUrl`                                              | normalized                                                                                                   |
| `name`            | `Schema.NullOr(Schema.String)`                         | published `name`, or null                                                                                    |
| `inputFeePpk`     | `Schema.NullOr(Schema.Int.pipe(Schema.nonNegative()))` | cashu input fee of the keyset the wallet spends from (lowest-fee active `sat` keyset); null when unpublished |
| `supportsMpp`     | `Schema.Boolean`                                       | NUT-15 multi-part payments                                                                                   |
| `isFakeLightning` | `Schema.Boolean`                                       | known test URL (`localhost`, `127.0.0.1`, `testnut.cashu.space`) or info text advertising a FakeWallet       |
| `iconUrl`         | `Schema.NullOr(Schema.String)`                         | an icon URL found in the published info, resolved against the mint URL                                       |

`inputFeePpk` is the **cashu** fee; the Lightning fee is a separate figure from [fee-probe.md](./fee-probe.md).

### The known-mint set

`knownMints` is the union of the mints named by stored rows (any state) and the _seen_ mints. A mint is recorded as seen the first time any operation loads its wallet successfully — `Mints.info` included — or explicitly through `addKnownMint`, which needs no network and is the way to register a mint before it holds funds.

`removeKnownMint` forgets a seen mint so `Restore` and `Validation` stop probing it. Stored rows name their mint themselves, so the call fails with `MintInUse` while any row (whatever its state) still does; delete or spend those rows first (`Tokens.deleteSpent` for `error` rows). `Restore.wipeSeedBoundState` leaves the seen set alone. Restore defaults to `knownMints` when you pass no `mints`.

Successful wallet loads are cached for the runtime's lifetime; a failed load is evicted so the next call retries.

### Icons (`mint/icons.ts`)

Pure helpers, no runtime needed:

| Export                               | Use                                                                          |
| ------------------------------------ | ---------------------------------------------------------------------------- |
| `GENERIC_MINT_ICON_DATA_URL`         | inline SVG fallback                                                          |
| `getMintIconOverride(host)`          | hand-picked icon URLs for well-known mints, by host; null otherwise          |
| `findMintInfoIconValue(value, seen)` | deep search of a NUT-06 info object for an icon-ish string; pass `new Set()` |
| `isTestMintUrl(mint)`                | true for local/test hosts                                                    |

## Inputs and outputs

`info(mint: MintUrl)`: `Effect<MintInfo, MintUnreachable | MintRejected>` — fields above.

`knownMints`: `Effect<ReadonlyArray<MintUrl>>`, sorted.

`addKnownMint(mint: MintUrl)`: `Effect<void>`; idempotent.

`removeKnownMint(mint: MintUrl)`: `Effect<void, MintInUse>`; a no-op for a mint that was never seen.

## Errors

| Tag               | Raised by         | When                                                       | What to do                                    |
| ----------------- | ----------------- | ---------------------------------------------------------- | --------------------------------------------- |
| `MintUnreachable` | `info`            | network/timeout/5xx during wallet load                     | retry later; show cached info if you keep any |
| `MintRejected`    | `info`            | the mint answered but its info/keysets are unusable        | surface `detail`                              |
| `MintInUse`       | `removeKnownMint` | stored rows still name the mint (`rowCount` says how many) | delete or spend those rows, then retry        |

`knownMints` and `addKnownMint` never fail.

## Related

- [fee-probe.md](./fee-probe.md) — the Lightning side of fees
- [restore.md](./restore.md) — consumer of `knownMints`
- [ports.md](./ports.md)
