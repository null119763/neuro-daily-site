import { describe, expect, it } from "vitest";
import { AuthThrottle, SlidingWindowLimiter, clientIp } from "@/server/rate-limit";
import { isEmailAllowed, loadConfig } from "@/server/config";

describe("SlidingWindowLimiter", () => {
  it("blocks after max hits and frees the slot when the window slides", () => {
    let t = 0;
    const l = new SlidingWindowLimiter({ max: 2, windowMs: 1000 }, () => t);
    l.hit("k");
    t = 400;
    l.hit("k");
    expect(l.retryAfterSec("k")).toBe(1);
    t = 1001;
    expect(l.retryAfterSec("k")).toBe(0);
    l.reset("k");
    expect(l.retryAfterSec("k")).toBe(0);
  });

  it("stays bounded under many distinct keys", () => {
    const l = new SlidingWindowLimiter({ max: 1, windowMs: 60_000 }, () => 0, 100);
    for (let i = 0; i < 1000; i++) l.hit(`k${i}`);
    expect((l as unknown as { hits: Map<string, number[]> }).hits.size).toBeLessThanOrEqual(101);
  });
});

describe("AuthThrottle", () => {
  it("locks an email after repeated failures and unlocks on success", () => {
    let t = 0;
    const th = new AuthThrottle(
      { failedPerEmail: { max: 3, windowMs: 60_000 }, failedPerIp: { max: 100, windowMs: 60_000 }, signupsPerIp: { max: 2, windowMs: 60_000 } },
      () => t,
    );
    for (let i = 0; i < 3; i++) th.recordSignInFailure("a@x.dev", "1.1.1.1");
    expect(th.signInBlockedFor("a@x.dev", "2.2.2.2")).toBe(60);
    expect(th.signInBlockedFor("b@x.dev", "1.1.1.1")).toBe(0);
    t = 61_000;
    expect(th.signInBlockedFor("a@x.dev", "1.1.1.1")).toBe(0);
    th.recordSignInFailure("a@x.dev", "1.1.1.1");
    th.recordSignInSuccess("a@x.dev");
    expect(th.signInBlockedFor("a@x.dev", "1.1.1.1")).toBe(0);
    expect(th.takeSignUp("9.9.9.9")).toBe(0);
    expect(th.takeSignUp("9.9.9.9")).toBe(0);
    expect(th.takeSignUp("9.9.9.9")).toBeGreaterThan(0);
  });

  it("reads the client IP only from trusted proxy headers", () => {
    const req = new Request("http://x", { headers: { "x-forwarded-for": "203.0.113.5, 10.0.0.1" } });
    expect(clientIp(req, true)).toBe("203.0.113.5");
    expect(clientIp(req, false)).toBe("unknown");
  });
});

describe("sign-up modes", () => {
  it("parses modes with backward compatibility", () => {
    expect(loadConfig({} as NodeJS.ProcessEnv).signupMode).toBe("open");
    expect(loadConfig({ AUDEN_SIGNUPS_OPEN: "false" } as unknown as NodeJS.ProcessEnv).signupMode).toBe("closed");
    expect(loadConfig({ AUDEN_SIGNUP_MODE: "ALLOWLIST" } as unknown as NodeJS.ProcessEnv).signupMode).toBe("allowlist");
  });
  it("matches emails and domains case-insensitively", () => {
    const cfg = { signupMode: "allowlist" as const, allowedEmails: ["alice@x.dev", "@team.dev"] };
    expect(isEmailAllowed("Alice@X.dev", cfg)).toBe(true);
    expect(isEmailAllowed("bob@team.dev", cfg)).toBe(true);
    expect(isEmailAllowed("bob@evilteam.dev", cfg)).toBe(false);
    expect(isEmailAllowed("bob@x.dev", cfg)).toBe(false);
  });
});
