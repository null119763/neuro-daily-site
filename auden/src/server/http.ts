import type { CookieJar, CookieOptions } from "./backend";

/** Cookie jar over a standard Request; collected Set-Cookie headers are applied to the Response. */
export class RequestCookieJar implements CookieJar {
  private readonly incoming = new Map<string, string>();
  private readonly outgoing: string[] = [];

  constructor(req: Request) {
    const header = req.headers.get("cookie") ?? "";
    for (const part of header.split(";")) {
      const i = part.indexOf("=");
      if (i < 0) continue;
      const name = part.slice(0, i).trim();
      if (!name) continue;
      try {
        this.incoming.set(name, decodeURIComponent(part.slice(i + 1).trim()));
      } catch {
        this.incoming.set(name, part.slice(i + 1).trim());
      }
    }
  }

  get(name: string) {
    return this.incoming.get(name);
  }

  getAll() {
    return [...this.incoming].map(([name, value]) => ({ name, value }));
  }

  set(name: string, value: string, o: CookieOptions = {}) {
    this.incoming.set(name, value);
    const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${o.path ?? "/"}`];
    if (o.maxAge !== undefined) parts.push(`Max-Age=${o.maxAge}`);
    if (o.expires) parts.push(`Expires=${o.expires.toUTCString()}`);
    if (o.httpOnly) parts.push("HttpOnly");
    if (o.secure) parts.push("Secure");
    if (o.sameSite) parts.push(`SameSite=${o.sameSite[0]!.toUpperCase()}${o.sameSite.slice(1)}`);
    this.outgoing.push(parts.join("; "));
  }

  apply(res: Response): Response {
    for (const c of this.outgoing) res.headers.append("Set-Cookie", c);
    return res;
  }
}

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}

export function errorJson(status: number, code: string, message?: string, extra: Record<string, unknown> = {}): Response {
  const headers: Record<string, string> = {};
  if (typeof extra.retryAfterSec === "number") headers["Retry-After"] = String(extra.retryAfterSec);
  return json({ error: { code, message: message ?? code, ...extra } }, status, headers);
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

const MAX_BODY_BYTES = 64 * 1024;

export async function readJson(req: Request): Promise<unknown> {
  const ct = req.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) throw new HttpError(415, "unsupported_media_type");
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) throw new HttpError(413, "payload_too_large");
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new HttpError(400, "invalid_json");
  }
}

/**
 * CSRF defence for cookie-authenticated mutations: if the browser sends Origin, it must match the host.
 * Combined with SameSite=Lax cookies and JSON-only bodies.
 */
export function assertSameOrigin(req: Request): void {
  if (req.method === "GET" || req.method === "HEAD") return;
  const origin = req.headers.get("origin");
  if (!origin) return;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new HttpError(403, "bad_origin");
  }
  if (originHost !== host) throw new HttpError(403, "bad_origin");
}
