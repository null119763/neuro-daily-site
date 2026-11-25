import { describe, expect, it } from "vitest";
import { computeMetrics, percentile, type MetricsData } from "@/server/metrics";

const now = new Date("2026-03-15T12:00:00Z");
const at = (day: number, hour = 10) => new Date(Date.UTC(2026, 2, day, hour)).toISOString();
const ev = (userId: string, day: number, over: Partial<MetricsData["usage"][number]> = {}): MetricsData["usage"][number] => ({
  userId,
  provider: "openrouter",
  model: "m-a:free",
  mode: "core",
  status: "complete",
  errorCode: null,
  ttftMs: 300,
  latencyMs: 2000,
  inputTokens: 100,
  outputTokens: 50,
  cost: 0,
  createdAt: at(day),
  ...over,
});

describe("percentile", () => {
  it("uses nearest rank", () => {
    expect(percentile([], 50)).toBeNull();
    expect(percentile([5], 95)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10);
  });
});

describe("computeMetrics", () => {
  const data: MetricsData = {
    users: [
      { id: "a", createdAt: at(1) },
      { id: "b", createdAt: at(1) },
      { id: "c", createdAt: at(10) },
      { id: "old", createdAt: "2026-01-01T00:00:00Z" },
    ],
    usage: [
      ev("a", 1), ev("a", 2), ev("a", 8), // a returns on D1 and D7
      ev("b", 1, { latencyMs: 8000, ttftMs: 900 }),
      ev("b", 1, { status: "error", errorCode: "timeout", latencyMs: 30000, ttftMs: null, model: "m-b:free" }),
      ev("c", 10, { status: "cancelled", errorCode: "cancelled", mode: "prime" }),
      ev("c", 15, { cost: 0.002 }),
      ev("old", 1, { createdAt: "2026-02-01T00:00:00Z" }), // outside the period
    ],
    feedback: [
      { rating: 1, provider: "openrouter", model: "m-a:free", createdAt: at(2) },
      { rating: 1, provider: "openrouter", model: "m-a:free", createdAt: at(8) },
      { rating: -1, provider: "openrouter", model: "m-a:free", createdAt: at(8) },
    ],
  };
  const r = computeMetrics(data, { now, days: 15 });

  it("covers the period day by day", () => {
    expect(r.period).toEqual({ from: "2026-03-01", to: "2026-03-15", days: 15 });
    expect(r.daily).toHaveLength(15);
    expect(r.daily[0]).toMatchObject({ date: "2026-03-01", requests: 3, activeUsers: 2, newUsers: 2, errors: 1 });
  });

  it("computes totals, rates and latency over completed answers", () => {
    expect(r.totals).toMatchObject({ users: 4, newUsers: 3, activeUsers: 3, requests: 7, feedbackUp: 2, feedbackDown: 1 });
    expect(r.totals.successRate).toBeCloseTo(5 / 7);
    expect(r.totals.errorRate).toBeCloseTo(1 / 7);
    expect(r.totals.cancelledRate).toBeCloseTo(1 / 7);
    expect(r.totals.latencyP50).toBe(2000);
    expect(r.totals.latencyP95).toBe(8000);
    expect(r.totals.satisfaction).toBeCloseTo(2 / 3);
    expect(r.totals.cost).toBeCloseTo(0.002);
    expect(r.totals.costPerAnswer).toBeCloseTo(0.002 / 5);
    expect(r.totals.requestsPerActiveUser).toBeCloseTo(7 / 3);
  });

  it("computes D1/D7 retention for cohorts in the period", () => {
    // a and b signed up on day 1; c on day 10. Day 14 is the last complete day.
    expect(r.retention.d1).toEqual({ eligible: 3, retained: 1, rate: 1 / 3 });
    expect(r.retention.d7).toEqual({ eligible: 2, retained: 1, rate: 0.5 });
    expect(r.retention.returningUsers).toBe(2);
  });

  it("breaks down by model, mode and error", () => {
    expect(r.byModel[0]).toMatchObject({ model: "m-a:free", requests: 6, up: 2, down: 1 });
    expect(r.byModel.find((m) => m.model === "m-b:free")).toMatchObject({ requests: 1, successRate: 0 });
    expect(r.byMode.find((m) => m.mode === "prime")).toMatchObject({ requests: 1, successRate: 0 });
    expect(r.errors).toEqual([{ code: "timeout", count: 1 }, { code: "cancelled", count: 1 }]);
  });

  it("returns nulls instead of NaN when there is no data", () => {
    const empty = computeMetrics({ users: [], usage: [], feedback: [] }, { now, days: 7 });
    expect(empty.totals.successRate).toBeNull();
    expect(empty.totals.latencyP50).toBeNull();
    expect(empty.retention.d1.rate).toBeNull();
    expect(JSON.stringify(empty)).not.toContain("NaN");
  });
});
