/**
 * Server-side quotas. Counts come from persisted usage events, so limits hold across
 * serverless instances and restarts (no in-memory counters).
 */
export interface QuotaLimits {
  userPerMinute: number;
  userPerDay: number;
  /** Global daily request ceiling across all users (protects the provider account and budget). */
  globalPerDay: number;
  /** Global daily spend ceiling in USD. With free models only this stays 0. */
  globalCostPerDayUsd: number;
}

export interface UsageCounter {
  countUserRequests(userId: string, since: Date): Promise<number>;
  countGlobalRequests(since: Date): Promise<number>;
  sumGlobalCost(since: Date): Promise<number>;
}

export type QuotaDecision =
  | { ok: true; remainingToday: number }
  | { ok: false; code: "rate_limited" | "user_daily" | "global_daily" | "budget"; retryAfterSec: number };

export function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export async function checkQuota(counter: UsageCounter, userId: string, limits: QuotaLimits, now = new Date()): Promise<QuotaDecision> {
  const dayStart = startOfUtcDay(now);
  const secondsToMidnight = Math.ceil((dayStart.getTime() + 86_400_000 - now.getTime()) / 1000);

  const [minute, today, globalToday, globalCost] = await Promise.all([
    counter.countUserRequests(userId, new Date(now.getTime() - 60_000)),
    counter.countUserRequests(userId, dayStart),
    counter.countGlobalRequests(dayStart),
    counter.sumGlobalCost(dayStart),
  ]);

  if (globalCost >= limits.globalCostPerDayUsd && limits.globalCostPerDayUsd >= 0 && globalCost > 0) {
    return { ok: false, code: "budget", retryAfterSec: secondsToMidnight };
  }
  if (globalToday >= limits.globalPerDay) return { ok: false, code: "global_daily", retryAfterSec: secondsToMidnight };
  if (today >= limits.userPerDay) return { ok: false, code: "user_daily", retryAfterSec: secondsToMidnight };
  if (minute >= limits.userPerMinute) return { ok: false, code: "rate_limited", retryAfterSec: 60 };
  return { ok: true, remainingToday: limits.userPerDay - today - 1 };
}
