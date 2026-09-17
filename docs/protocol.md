# Linky Nostr protocol

Linky is a local-first messaging and payments client. Its wire protocol is Nostr,
but several message types and conventions are Linky-specific and exist only in the
`@linky/linkstr` codecs. This document is the single specification of what travels
on the wire, so behavior is reviewable, other clients could in principle
interoperate, and future changes are diffed against a spec instead of
reverse-engineered from code.

The authoritative implementation is `packages/linkstr/src`. Each event kind below
names the codec that defines it. When a wire format changes, update this document
in the same commit.

## Terminology and layering

Conversational events are never published in the clear. They follow NIP-59 gift
wrapping in three nested layers:

| Layer     |                           Kind                           | Signed by           | Purpose                                                       |
| --------- | :------------------------------------------------------: | ------------------- | ------------------------------------------------------------- |
| Rumor     | kind-specific (14, 15, 7, 5, 24133, 24134, 24135, 24136) | unsigned            | the actual payload                                            |
| Seal      |                            13                            | sender identity key | hides the rumor and authenticates the sender to the recipient |
| Gift wrap |                           1059                           | fresh ephemeral key | hides the seal from relays; only the recipient can open it    |

Rumors are created with a stable content hash as their `id` (`rumorWithHash`), so
the same logical message keeps one id across retries and across the self and
recipient copies. Seals and wraps are produced by `nostr-tools/nip59`
(`createSeal`, `wrapEvent`) with NIP-44 v2 encryption.

Plain replaceable events (profile, status, mute list, relay lists) are published
signed by the identity key with no wrapping, exactly as their NIPs define.

Non-relay events (Blossom upload auth, NIP-98 HTTP auth, push ownership proof)
are signed and sent as HTTP `Authorization` material, never published to relays.

### Delivery model

Defined in `internal/wrapDelivery.ts`. Every wrapped rumor is delivered twice:

- **Self copy** — wrapped to the sender's own pubkey, for cross-device echo.
- **Recipient copy** — wrapped to the peer.

Both copies wrap the same rumor id and both publish to `relayPolicy.writeRelays`.
Delivery counts as successful only when the recipient copy is accepted by at least
one relay. Wrap `created_at` is randomized within the last two days per NIP-59;
rumor `created_at` is the real send time.

Both wrap copies currently go to the same relay set over the same connection that
subscribes for the inbox, which lets a relay correlate sender and recipient; this
is tracked in issue #258.

### Shared tag conventions

- **`["p", <pubkey>]` ordering.** For directed rumors the recipient is tagged
  first and the author second. Decoders rely on this to recover the peer, so the
  order is part of the format.
- **`["client", <uuid>]`.** A client-generated UUID (`ClientId`, a branded
  non-empty string in `domain/primitives.ts`). It is an idempotency and
  correlation key: it exists before the rumor is encoded and stays stable across
  retries, unlike the rumor id, which changes with `created_at`. The receive side
  matches it back to pending optimistic rows. This is a house convention and
  collides with NIP-89's `["client", …]`; the collision is tracked in issue #254.
- **`["linky", <value>]` marker family.** A namespaced tag used two ways:
  - `["linky", "push"]` on a gift wrap (kind 1059) tells the push service, which
    cannot decrypt the wrap, that this copy should trigger a notification. Only the
    recipient copy of a push-worthy message carries it; self copies and edits do
    not. The plaintext marker is a deliberate metadata leak, tracked in issue #245.
  - Inside a rumor, `["linky", <type>]` discriminates Linky-specific kinds:
    `payment_notice`, `seen_receipt`, `bank_payment_offer`, `payment_telemetry`.
- **Encryption.** NIP-44 v2 conversation keys throughout
  (`nostr-tools/nip44`).

## Wrapped event kinds

### Chat text — kind 14

Codec: `chat/codec.ts` (`CHAT_TEXT_KIND`).

- Tags: `["p", to]`, `["p", author]`, `["client", clientId]`, then reply tags when
  present: `["e", root ?? replyTo, "", "root"]` and `["e", replyTo, "", "reply"]`.
- Content: the plaintext message body.
- A **Cashu token message** reuses kind 14 unchanged: the content is the raw
  `cashuB…` token text instead of prose. Receivers detect it by parsing the
  content as a token, not by a distinct kind or tag.
- Push: the recipient copy of a new message is push-marked.

### Chat edit — kind 14 with `edited_from`

Codec: `chat/codec.ts` (`encodeEditRumor`).

- Tags: `["p", to]`, `["p", author]`, `["edited_from", editOf]`, `["client", clientId]`.
- Content: the replacement text. `edited_from` points at the rumor id being edited.
- Push: edits are **not** push-marked.

### Chat image — kind 15

Codec: `chat/codec.ts` (`CHAT_IMAGE_KIND`, `encodeImageMessageRumor`).

- Tags, in order: `["p", to]`, `["p", author]`, `["client", clientId]`,
  `["file-type", …]`, `["encryption-algorithm", …]`, `["decryption-key", …]`,
  `["decryption-nonce", …]`, `["x", encryptedSha256]`, `["ox", originalSha256]`,
  `["size", encryptedSize]`, optional `["dim", "<w>x<h>"]`, optional
  `["name", fileName]`, optional `["encoding", "base64"]`, then reply tags.
- Content: the URL of the encrypted blob (Blossom).
- The blob is fetched and decrypted client-side with the key and nonce from the
  tags. The Blossom upload path is audited in issue #247.

### Reaction — kind 7

Codec: `reactions/codec.ts` (`REACTION_KIND`).

- Tags, in order: `["p", targetAuthor]`, `["p", to]`, `["p", author]`,
  `["e", target]`, `["k", "14" | "15"]`, `["client", clientId]`.
- Content: the emoji.
- `k` records whether the target was a text (14) or image (15) message.

### Retraction — kind 5

Codec: `reactions/codec.ts` (`RETRACTION_KIND`). NIP-09 deletion applied to
reactions.

- Tags: `["p", to]`, `["p", author]`, one `["e", reactionId]` per retracted
  reaction, `["client", clientId]`.
- Content: empty string.

### Payment notice — kind 24133

Codec: `paymentNotices/codec.ts` (`PAYMENT_NOTICE_KIND`).

- Tags: `["p", to]`, `["p", author]`, `["client", clientId]`,
  `["linky", "payment_notice"]`, optional `["context", <context>]`, optional
  `["offer", <offerId>]`.
- Content: the literal string `payment_notice`.
- Only the recipient receives a notice, and its wrap is push-marked; it is the
  signal the push service keys off for payment notifications. The token itself
  travels as a separate kind-14 message. The end-to-end mechanism and its dedup
  window are covered in issue #246.
- Decode requires the `["linky", "payment_notice"]` marker, a `p` tag for the
  reader, and a sender that is not the reader.

### Payment telemetry — kind 24134

Codec: `paymentTelemetry/codec.ts` (`PAYMENT_TELEMETRY_KIND`).

- Tags: `["p", collector]`, `["client", draft.id]`, `["linky", "payment_telemetry"]`.
- Content: JSON with a fixed field order:

```json
{
  "v": 1,
  "id": "…",
  "createdAtSec": 0,
  "direction": "…",
  "status": "…",
  "method": "…",
  "phase": "…",
  "mint": "…",
  "amountBucket": "…",
  "feeBucket": "…",
  "errorCode": "…",
  "errorDetail": "…",
  "appHost": "…",
  "devicePlatform": "…",
  "appRuntime": "…",
  "appVersion": "…"
}
```

- Each report is authored by a fresh ephemeral key and gift-wrapped to a fixed
  collector pubkey; amounts and fees are bucketed rather than exact. There is
  currently no consent surface and `errorDetail` is an unsanitized exception
  string; both are tracked in issue #263.

### Bank payment offer — kind 24135

Codec: `bankOffers/codec.ts` (`BANK_OFFER_KIND`).

- Tags, in order: `["p", to]`, `["p", author]`, `["client", clientId]`,
  `["offer", offerId]`, `["offerer", offererPubkey]`, `["linky", "bank_payment_offer"]`,
  `["status", status]`.
- Content: JSON with a fixed key order; `null` fields are omitted:

```json
{
  "amountText": "…",
  "offerId": "…",
  "offererPublicKey": "…",
  "status": "offered",
  "statusUpdatedAtSec": 0,
  "text": "…",
  "type": "linky.bank_payment_offer",
  "version": 1
}
```

- An offer is a mutable object: later rumors with the same `offerId` carry a new
  `status` and updated timestamps, and the receiver folds them into one offer row.

### Seen receipt — kind 24136

Codec: `seenReceipts/codec.ts` (`SEEN_RECEIPT_KIND`).

- Tags: `["p", to]`, `["p", author]`, `["client", clientId]`,
  `["linky", "seen_receipt"]`, `["since", <sinceSec>]`.
- Content: the number of the newest second the reader has seen, as a string.
- A receipt covers the half-open range `(sinceSec, seenUpToSec]`; decode rejects a
  receipt where `sinceSec >= seenUpToSec`.

## Plain (unwrapped) events

### Profile metadata — kind 0

Codec: `profiles/codec.ts` (`PROFILE_KIND`). NIP-01 metadata.

- Content: JSON emitting standard field names only —
  `name`, `display_name`, `picture`, `lud16`, `lud06`, `nip05`, `about` — with
  empty fields omitted.
- Decoding is tolerant: unknown fields are ignored, a nonstandard `displayName`
  is accepted when `display_name` is absent, and `picture` falls back to a legacy
  `image` field.

### Status — kind 30315

Codec: `profiles/codec.ts` (`STATUS_KIND`). NIP-38, addressable by
`["d", "general"]`.

### Mute list — kind 10000

Codec: `muteList/MuteList.ts`. NIP-51.

- Tags: one public `["p", <mutedPubkey>]` per muted contact.
- Content: empty string.
- The whole cumulative list is republished on every change. The list is currently
  a public, signed, scrapeable block list; moving the entries into encrypted
  content is tracked in issue #262.

### Relay list — kind 10002

Codec: `relayLists/RelayLists.ts` (`RELAY_LIST_KIND`). NIP-65.

- Tags: `["r", <relayUrl>]`, or `["r", <relayUrl>, "read" | "write"]` when the
  entry is one-directional.

### DM relay list — kind 10050

Codec: `relayLists/RelayLists.ts` (`DM_RELAY_LIST_KIND`). NIP-17 DM relays.

- Tags: `["relay", <relayUrl>]` per relay.

## HTTP authorization events (not published to relays)

These are signed events serialized into an HTTP `Authorization` header, never sent
to a relay. Codec: `httpAuth/codec.ts`.

### Blossom upload auth — kind 24242

BUD-01. Tags: `["t", "upload"]`, `["expiration", <now + 600>]`, `["x", <sha256>]`,
`["server", <serverDomain>]`. Content: `Upload Blob`. Valid for 600 seconds.

### NIP-98 HTTP auth — kind 27235

Standard NIP-98 request authentication.

### Push ownership proof — kind 27235

A NIP-98-style proof the push service challenges for. Tags: `["challenge", <challenge>]`,
`["action", <action>]`. Content: `linky-push-<action>`. Verified server-side against
the issued challenge and action.

## Maintaining this document

This spec is generated from and must stay consistent with the `@linky/linkstr`
codecs. A change to any wire format — a new kind, a new or reordered tag, a content
schema change, or a delivery or push rule change — updates the relevant section
here in the same commit.
