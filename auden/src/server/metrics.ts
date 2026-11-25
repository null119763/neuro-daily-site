/**
 * Alpha metrics (ROADMAP stage 6: retention, quality, cost per answer, latency).
 * Input is aggregate-friendly raw data without any message content; both backends feed the same
 * pure function so the numbers are computed identically. Days are UTC.
 */
export interface MetricsData {
  users: { id: string; createdAt: string }[];
  usage: {
    userId: string | null;
    provider: string;
    model: string;
    mode: string | null;
    status: "complete" | "error" | "cancelled";
    errorCode: string | null;
    ttftMs: number | null;
    latencyMs: number | null;
    inputTokens: number;
    outputTokens: number;
    cost: number;
    createdAt: string;
  }[];
  feedback: { rating: 1 | -1; provider: string | null; model: string | null; createdAt: string }[];
}

export interface Rate {
  eligible: number;
  retained: number;
  rate: number | null;
}

export interface MetricsReport {
  period: { from: string; to: string; days: number };
  totals: {
    users: number;
    newUsers: number;
    activeUsers: number;
    requests: number;
    successRate: number | null;
    cancelledRate: number | null;
    errorRate: number | null;
    ttftP50: number | null;
    ttftP95: number | null;
    latencyP50: number | null;
    latencyP95: number | null;
    inputTokens: number;
    outputTokens: number;
    cost: number;
    costPerAnswer: number | null;
    requestsPerActiveUser: number | null;
    feedbackUp: number;
    feedbackDown: number;
    satisfaction: number | null;
  };
  retention: { d1: Rate; d7: Rate; returningUsers: number };
  daily: { date: string; requests: number; activeUsers: number; newUsers: number; errors: number; latencyP50: number | null; latencyP95: number | null; up: number; down: number }[];
  byModel: { provider: string; model: string; requests: number; successRate: number | null; latencyP50: number | null; up: number; down: number }[];
  byMode: { mode: string; requests: number; successRate: number | null }[];
  errors: { code: string; count: number }[];
}

const DAY = 86_400_000;
export const dayKey = (iso: string | number | Date) => new Date(iso).toISOString().slice(0, 10);

/** Nearest-rank percentile; null for empty input. */
export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(Math.max(rank, 1), sorted.length) - 1]!;
}

const ratio = (a: number, b: number) => (b > 0 ? a / b : null);
const nums = (xs: (number | null)[]) => xs.filter((x): x is number => typeof x === "number");

export function computeMetrics(data: MetricsData, opts: { now?: Date; days: number }): MetricsReport {
  const now = opts.now ?? new Date();
  const todayStart = Date.parse(dayKey(now));
  const fromMs = todayStart - (opts.days - 1) * DAY;
  const inPeriod = (iso: string) => Date.parse(iso) >= fromMs && Date.parse(iso) <= now.getTime();

  const usage = data.usage.filter((u) => inPeriod(u.createdAt));
  const feedback = data.feedback.filter((f) => inPeriod(f.createdAt));
  const completed = usage.filter((u) => u.status === "complete");

  // Activity per user per day (all fetched usage, so retention can look past the period start).
  const activeDays = new Map<string, Set<string>>();
  for (const u of data.usage) {
    if (!u.userId) continue;
    const set = activeDays.get(u.userId) ?? new Set<string>();
    set.add(dayKey(u.createdAt));
    activeDays.set(u.userId, set);
  }
  const activeInPeriod = new Set(usage.map((u) => u.userId).filter((x): x is string => Boolean(x)));

  function cohort(offsetDays: number): Rate {
    let eligible = 0;
    let retained = 0;
    for (const user of data.users) {
      const signup = Date.parse(dayKey(user.createdAt));
      const target = signup + offsetDays * DAY;
      if (target > todayStart - DAY) continue; // the target day must be complete
      if (signup < fromMs) continue; // cohorts that signed up within the period
      eligible++;
      if (activeDays.get(user.id)?.has(dayKey(target))) retained++;
    }
    return { eligible, retained, rate: ratio(retained, eligible) };
  }

  const daily: MetricsReport["daily"] = [];
  for (let t = fromMs; t <= todayStart; t += DAY) {
    const key = dayKey(t);
    const dayUsage = usage.filter((u) => dayKey(u.createdAt) === key);
    const lat = nums(dayUsage.map((u) => u.latencyMs));
    const fb = feedback.filter((f) => dayKey(f.createdAt) === key);
    daily.push({
      date: key,
      requests: dayUsage.length,
      activeUsers: new Set(dayUsage.map((u) => u.userId).filter(Boolean)).size,
      newUsers: data.users.filter((x) => dayKey(x.createdAt) === key).length,
      errors: dayUsage.filter((u) => u.status === "error").length,
      latencyP50: percentile(lat, 50),
      latencyP95: percentile(lat, 95),
      up: fb.filter((f) => f.rating === 1).length,
      down: fb.filter((f) => f.rating === -1).length,
    });
  }

  const modelKey = (p: string | null, m: string | null) => `${p ?? "?"}\u0000${m ?? "?"}`;
  const models = new Map<string, MetricsData["usage"]>();
  for (const u of usage) models.set(modelKey(u.provider, u.model), [...(models.get(modelKey(u.provider, u.model)) ?? []), u]);
  const byModel = [...models.entries()]
    .map(([key, list]) => {
      const [provider, model] = key.split("\u0000") as [string, string];
      const fb = feedback.filter((f) => modelKey(f.provider, f.model) === key);
      return {
        provider,
        model,
        requests: list.length,
        successRate: ratio(list.filter((u) => u.status === "complete").length, list.length),
        latencyP50: percentile(nums(list.map((u) => u.latencyMs)), 50),
        up: fb.filter((f) => f.rating === 1).length,
        down: fb.filter((f) => f.rating === -1).length,
      };
    })
    .sort((a, b) => b.requests - a.requests);

  const modes = new Map<string, MetricsData["usage"]>();
  for (const u of usage) modes.set(u.mode ?? "—", [...(modes.get(u.mode ?? "—") ?? []), u]);
  const byMode = [...modes.entries()].map(([mode, list]) => ({ mode, requests: list.length, successRate: ratio(list.filter((u) => u.status === "complete").length, list.length) }));

  const errorCounts = new Map<string, number>();
  for (const u of usage) if (u.status !== "complete") errorCounts.set(u.errorCode ?? u.status, (errorCounts.get(u.errorCode ?? u.status) ?? 0) + 1);

  const up = feedback.filter((f) => f.rating === 1).length;
  const down = feedback.filter((f) => f.rating === -1).length;
  const cost = usage.reduce((a, u) => a + u.cost, 0);

  return {
    period: { from: dayKey(fromMs), to: dayKey(now), days: opts.days },
    totals: {
      users: data.users.filter((u) => Date.parse(u.createdAt) <= now.getTime()).length,
      newUsers: data.users.filter((u) => inPeriod(u.createdAt)).length,
      activeUsers: activeInPeriod.size,
      requests: usage.length,
      successRate: ratio(completed.length, usage.length),
      cancelledRate: ratio(usage.filter((u) => u.status === "cancelled").length, usage.length),
      errorRate: ratio(usage.filter((u) => u.status === "error").length, usage.length),
      ttftP50: percentile(nums(usage.map((u) => u.ttftMs)), 50),
      ttftP95: percentile(nums(usage.map((u) => u.ttftMs)), 95),
      latencyP50: percentile(nums(completed.map((u) => u.latencyMs)), 50),
      latencyP95: percentile(nums(completed.map((u) => u.latencyMs)), 95),
      inputTokens: usage.reduce((a, u) => a + u.inputTokens, 0),
      outputTokens: usage.reduce((a, u) => a + u.outputTokens, 0),
      cost,
      costPerAnswer: ratio(cost, completed.length),
      requestsPerActiveUser: ratio(usage.length, activeInPeriod.size),
      feedbackUp: up,
      feedbackDown: down,
      satisfaction: ratio(up, up + down),
    },
    retention: {
      d1: cohort(1),
      d7: cohort(7),
      returningUsers: [...activeInPeriod].filter((id) => [...(activeDays.get(id) ?? [])].filter((d) => Date.parse(d) >= fromMs).length >= 2).length,
    },
    daily,
    byModel,
    byMode,
    errors: [...errorCounts.entries()].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count),
  };
}
