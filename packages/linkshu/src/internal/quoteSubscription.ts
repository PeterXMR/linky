import type { MintQuoteBolt11Response } from "@cashu/cashu-ts";
import { Effect } from "effect";
import type { MintRejected, MintUnreachable } from "../domain/errors";
import type { CurrencyUnit, MintUrl, QuoteId } from "../domain/primitives";
import { classifyMintError } from "../mint/internal/WalletInstances";
import type { LoadedWallet } from "../mint/internal/WalletInstances";

// NUT-17: instead of polling a quote, subscribe and let the mint push its
// state changes over a websocket. The mint replays the current state on
// subscribe, so nothing is lost between creating a quote and subscribing.

const BOLT11_METHOD = "bolt11";
const MINT_QUOTE_COMMAND = "bolt11_mint_quote";

/**
 * Websocket support is per method and unit, so a mint may push bolt11/sat
 * quotes and nothing else. An unloaded mint info throws rather than answering,
 * and an unknown answer means the same as "no": keep polling.
 */
export const supportsMintQuoteSubscription = (
  wallet: LoadedWallet,
  unit: CurrencyUnit,
): boolean => {
  try {
    const support = wallet.getMintInfo().isSupported(17);
    if (!support.supported) return false;
    return (support.params ?? []).some(
      (entry) =>
        entry.method === BOLT11_METHOD &&
        entry.unit === unit &&
        entry.commands.includes(MINT_QUOTE_COMMAND),
    );
  } catch {
    return false;
  }
};

/**
 * Resolves with the quote the mint reports as paid. Interrupting the effect
 * cancels the subscription, and a subscription that never establishes fails
 * like any other mint call.
 */
export const awaitMintQuotePaid = (
  wallet: LoadedWallet,
  quote: { readonly quoteId: QuoteId; readonly mint: MintUrl },
): Effect.Effect<MintQuoteBolt11Response, MintUnreachable | MintRejected> =>
  Effect.async<MintQuoteBolt11Response, MintUnreachable | MintRejected>(
    (resume) => {
      let cancel: (() => void) | null = null;
      let settled = false;

      const stop = (): void => {
        settled = true;
        cancel?.();
        cancel = null;
      };

      const fail = (error: unknown): void => {
        stop();
        resume(Effect.fail(classifyMintError(quote.mint, error)));
      };

      wallet.on
        .mintQuotePaid(
          quote.quoteId,
          (paid) => {
            stop();
            resume(Effect.succeed(paid));
          },
          fail,
        )
        .then((canceller) => {
          // The subscription may land after the effect was interrupted or the
          // quote already reported paid; either way it must not stay open.
          if (settled) canceller();
          else cancel = canceller;
        })
        .catch(fail);

      return Effect.sync(stop);
    },
  );
