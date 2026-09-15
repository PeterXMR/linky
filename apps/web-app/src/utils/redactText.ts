const stripUrlPayload = (value: string): string => {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "[redacted URL]";
  }
};

export const redactIdentityText = (value: string): string =>
  value
    .replace(/https?:\/\/[^\s)]+/g, stripUrlPayload)
    .replace(
      /\b(?:nsec|ncryptsec)1[023456789acdefghjklmnpqrstuvwxyz]+\b/gi,
      "[redacted secret key]",
    )
    .replace(/\bcashu[ab][a-z0-9_-]{20,}\b/gi, "[redacted cashu token]")
    .replace(
      /\bnpub1[023456789acdefghjklmnpqrstuvwxyz]{6,}\b/gi,
      "[redacted npub]",
    );

export const redactDiagnosticText = (value: string): string =>
  redactIdentityText(value).replace(
    /\b[0-9a-f]{64}\b/gi,
    "[redacted 32-byte value]",
  );
