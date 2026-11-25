/**
 * In-memory sliding-window limiter for auth endpoints (brute-force and mass sign-up protection).
 *
 * Scope: per server instance. That is sufficient for the local backend (single process). With Supabase,
 * Supabase Auth enforces its own server-side rate limits; this layer adds a friendlier, earlier refusal.
 * A multi-instance deployment that needs a shared counter can swap in a store-backed implementation.
 */
export interface LimitRule {
  max: number;
  windowMs: number;
}

export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly rule: LimitRule,
    private readonly now: () => number = Date.now,
    private readonly maxKeys = 50_000,
  ) {}

  private recent(key: string): number[] {
    const cutoff = this.now() - this.rule.windowMs;
    const list = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (list.length) this.hits.set(key, list);
    else this.hits.delete(key);
    return list;
  }

  /** Seconds until the key may try again, or 0 if allowed now. Does not record a hit. */
  retryAfterSec(key: string): number {
    const list = this.recent(key);
    if (list.length < this.rule.max) return 0;
    return Math.max(1, Math.ceil((list[0]! + this.rule.windowMs - this.now()) / 1000));
  }

  hit(key: string): void {
    const list = this.recent(key);
    list.push(this.now());
    this.hits.set(key, list);
    if (this.hits.size > this.maxKeys) this.prune();
  }

  reset(key: string): void {
    this.hits.delete(key);
  }

  private prune() {
    for (const key of [...this.hits.keys()]) this.recent(key);
    // Still too many keys (attack with many distinct keys): drop the oldest half.
    if (this.hits.size > this.maxKeys) {
      const keys = [...this.hits.keys()].slice(0, Math.floor(this.hits.size / 2));
      for (const k of keys) this.hits.delete(k);
    }
  }
}

export interface AuthLimits {
  /** Failed sign-ins per email. */
  failedPerEmail: LimitRule;
  /** Failed sign-ins per client IP (spraying many accounts). */
  failedPerIp: LimitRule;
  /** Sign-up attempts per client IP. */
  signupsPerIp: LimitRule;
}

export const DEFAULT_AUTH_LIMITS: AuthLimits = {
  failedPerEmail: { max: 5, windowMs: 15 * 60_000 },
  failedPerIp: { max: 30, windowMs: 15 * 60_000 },
  signupsPerIp: { max: 5, windowMs: 60 * 60_000 },
};

export class AuthThrottle {
  private readonly email: SlidingWindowLimiter;
  private readonly ip: SlidingWindowLimiter;
  private readonly signup: SlidingWindowLimiter;

  constructor(limits: AuthLimits = DEFAULT_AUTH_LIMITS, now: () => number = Date.now) {
    this.email = new SlidingWindowLimiter(limits.failedPerEmail, now);
    this.ip = new SlidingWindowLimiter(limits.failedPerIp, now);
    this.signup = new SlidingWindowLimiter(limits.signupsPerIp, now);
  }

  /** 0 if a sign-in attempt is allowed, else seconds to wait. */
  signInBlockedFor(email: string, ip: string): number {
    return Math.max(this.email.retryAfterSec(`e:${email}`), this.ip.retryAfterSec(`i:${ip}`));
  }

  recordSignInFailure(email: string, ip: string): void {
    this.email.hit(`e:${email}`);
    this.ip.hit(`i:${ip}`);
  }

  recordSignInSuccess(email: string): void {
    this.email.reset(`e:${email}`);
  }

  /** Records the attempt and returns 0 if allowed, else seconds to wait. */
  takeSignUp(ip: string): number {
    const wait = this.signup.retryAfterSec(`s:${ip}`);
    if (wait === 0) this.signup.hit(`s:${ip}`);
    return wait;
  }
}

/**
 * Client IP for rate limiting. Behind a hosting proxy (Netlify, Cloudflare, Render, Vercel) the platform
 * sets X-Forwarded-For / X-Real-IP. Without a trusted proxy these headers can be spoofed, which is why
 * the per-email limit — not the IP limit — is the primary brute-force defence.
 */
export function clientIp(req: Request, trustProxy: boolean): string {
  if (trustProxy) {
    const xff = req.headers.get("x-forwarded-for");
    if (xff) return xff.split(",")[0]!.trim().slice(0, 64);
    const real = req.headers.get("x-real-ip") ?? req.headers.get("cf-connecting-ip");
    if (real) return real.trim().slice(0, 64);
  }
  return "unknown";
}
