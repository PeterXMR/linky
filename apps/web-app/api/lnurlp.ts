import { isAllowedTarget, safeFetch } from "./_safeFetch.js";

const parseTarget = (raw: string | string[] | undefined): URL | null => {
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    return isAllowedTarget(url) ? url : null;
  } catch {
    return null;
  }
};

export default async function handler(
  req: { query?: Record<string, string | string[] | undefined> },
  res: {
    status: (code: number) => {
      json: (body: Record<string, unknown>) => void;
      send: (body: string) => void;
    };
    setHeader: (name: string, value: string) => void;
  },
) {
  const target = parseTarget(req.query?.url);
  if (!target) {
    res.status(400).json({ error: "Invalid url" });
    return;
  }

  try {
    // Fetch through the hardened guard (https-only, no ports/creds, public-IP
    // check, pinned connect, redirect re-validation). The response is always
    // served as JSON with nosniff and no open CORS: reflecting the upstream
    // content type turned this into reflected XSS on the app origin, and the
    // lack of an egress guard made it an open SSRF proxy.
    const result = await safeFetch(target);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.status(result.status).send(result.text);
  } catch {
    res.status(502).json({ error: "Proxy fetch failed" });
  }
}
