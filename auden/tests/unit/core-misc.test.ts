import { describe, expect, it } from "vitest";
import { buildContext } from "@/core/context";
import { detectMemoryProposal } from "@/core/memory";
import { checkQuota, type UsageCounter } from "@/core/quota";
import { createRouteResolver, parseModelList } from "@/core/router";
import { estimateTokens, truncateToTokens } from "@/core/tokens";
import { MockProvider } from "@/core/providers/mock";
import { OpenRouterProvider } from "@/core/providers/openrouter";
import type { ModelProvider } from "@/core/types";

describe("tokens", () => {
  it("estimates cyrillic as more expensive and truncates", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("привет мир привет")).toBeGreaterThan(estimateTokens("hello world hello"));
    const t = truncateToTokens("a".repeat(1000), 10);
    expect(estimateTokens(t)).toBeLessThanOrEqual(11);
  });
});

describe("buildContext", () => {
  const base = { locale: "ru" as const, memories: [], history: [], userMessage: "Вопрос", maxInputTokens: 4000, now: new Date("2026-01-02T00:00:00Z") };
  it("includes policy, profile, project, memory as data blocks", () => {
    const ctx = buildContext({ ...base, displayName: "Лев", customInstructions: "Кратко", project: { title: "Игра", instructions: "Жанр — RPG" }, memories: [{ content: "Любит чай" }] });
    expect(ctx[0]!.role).toBe("system");
    expect(ctx[0]!.content).toContain("2026-01-02");
    expect(ctx[0]!.content).toMatch(/<user_profile>[\s\S]*Лев[\s\S]*Кратко/);
    expect(ctx[0]!.content).toMatch(/<project>[\s\S]*RPG/);
    expect(ctx[0]!.content).toMatch(/<user_memory>[\s\S]*Любит чай/);
    expect(ctx.at(-1)).toEqual({ role: "user", content: "Вопрос" });
  });
  it("trims oldest history to fit the budget and starts with a user turn", () => {
    const history = Array.from({ length: 200 }, (_, i) => ({ role: (i % 2 ? "assistant" : "user") as "user" | "assistant", content: `message number ${i} `.repeat(10) }));
    const ctx = buildContext({ ...base, history, maxInputTokens: 1500 });
    const total = ctx.reduce((s, m) => s + estimateTokens(m.content) + 4, 0);
    expect(total).toBeLessThanOrEqual(1500);
    expect(ctx[1]!.role).toBe("user");
    expect(ctx.at(-2)!.content).toContain("message number 199");
  });
  it("omits memory block when there are no memories", () => {
    expect(buildContext(base)[0]!.content).not.toContain("Facts the user asked");
  });
});

describe("detectMemoryProposal", () => {
  it("detects RU and EN commands", () => {
    expect(detectMemoryProposal("Запомни, что я работаю дизайнером.")).toBe("я работаю дизайнером");
    expect(detectMemoryProposal("remember that I prefer short answers")).toBe("I prefer short answers");
    expect(detectMemoryProposal("Как запомнить слова?")).toBeNull();
  });
});

describe("checkQuota", () => {
  const limits = { userPerMinute: 2, userPerDay: 5, globalPerDay: 10, globalCostPerDayUsd: 0 };
  const counter = (u: number, minute: number, g: number, cost = 0): UsageCounter => ({
    countUserRequests: async (_id, since) => (Date.now() - since.getTime() <= 61_000 ? minute : u),
    countGlobalRequests: async () => g,
    sumGlobalCost: async () => cost,
  });
  it("allows within limits", async () => {
    expect(await checkQuota(counter(1, 0, 1), "u", limits)).toEqual({ ok: true, remainingToday: 3 });
  });
  it("enforces per-minute, daily, global and budget limits", async () => {
    expect(await checkQuota(counter(1, 2, 1), "u", limits)).toMatchObject({ ok: false, code: "rate_limited" });
    expect(await checkQuota(counter(5, 0, 1), "u", limits)).toMatchObject({ ok: false, code: "user_daily" });
    expect(await checkQuota(counter(1, 0, 10), "u", limits)).toMatchObject({ ok: false, code: "global_daily" });
    expect(await checkQuota(counter(1, 0, 1, 0.01), "u", limits)).toMatchObject({ ok: false, code: "budget" });
  });
});

describe("router", () => {
  it("parses model lists with provider prefixes", () => {
    expect(parseModelList("a:free, custom::my-model")).toEqual([{ provider: "openrouter", model: "a:free" }, { provider: "custom", model: "my-model" }]);
  });
  it("falls back to mock only when no real provider is configured", async () => {
    const providers = new Map<string, ModelProvider>([["mock", new MockProvider()], ["openrouter", new OpenRouterProvider({})]]);
    const resolve = createRouteResolver(providers, { explicit: {}, customFirstModes: [], customModels: [] });
    expect(await resolve("prime")).toEqual([{ provider: "mock", model: "mock-prime" }]);
  });
  it("uses explicit OpenRouter config when key is present", async () => {
    const providers = new Map<string, ModelProvider>([["mock", new MockProvider()], ["openrouter", new OpenRouterProvider({ apiKey: "k" })]]);
    const resolve = createRouteResolver(providers, { explicit: { air: [{ provider: "openrouter", model: "x:free" }] }, customFirstModes: [], customModels: [] });
    expect(await resolve("air")).toEqual([{ provider: "openrouter", model: "x:free" }]);
  });
});
