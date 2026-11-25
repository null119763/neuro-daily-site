import { describe, expect, it } from "vitest";
import { AudenEngine, type EngineEvent } from "@/core/engine";
import { MockProvider } from "@/core/providers/mock";
import { ProviderError, type ModelProvider, type StreamChunk } from "@/core/types";
import { collect } from "./helpers";

function fakeProvider(id: string, behaviour: (model: string, attempt: number, signal?: AbortSignal) => AsyncGenerator<StreamChunk>): ModelProvider & { attempts: Record<string, number> } {
  const attempts: Record<string, number> = {};
  return {
    id, label: id, attempts,
    isConfigured: () => true,
    listModels: async () => [],
    capabilities: async () => ({ streaming: true, maxContextTokens: 1000, vision: false, tools: false }),
    estimateCost: async () => 0,
    assertAllowed: async () => {},
    stream: (req) => { attempts[req.model] = (attempts[req.model] ?? 0) + 1; return behaviour(req.model, attempts[req.model]!, req.signal); },
  };
}

const msgs = [{ role: "user" as const, content: "hi" }];
const types = (evs: EngineEvent[]) => evs.map((e) => e.type);

describe("AudenEngine", () => {
  it("streams from the mock provider and reports usage", async () => {
    const engine = new AudenEngine({ providers: new Map([["mock", new MockProvider({ delayMs: 0 })]]), resolveRoute: async () => [{ provider: "mock", model: "mock-core" }] });
    const evs = await collect(engine.run({ mode: "core", messages: msgs }));
    expect(evs[0]).toMatchObject({ type: "route", provider: "mock", model: "mock-core" });
    const done = evs.at(-1)!;
    expect(done.type).toBe("done");
    if (done.type === "done") {
      expect(done.text).toContain("mock");
      expect(done.text).toBe(evs.filter((e) => e.type === "delta").map((e) => (e as { text: string }).text).join(""));
      expect(done.outputTokens).toBeGreaterThan(0);
    }
  });

  it("retries retryable errors with backoff, then succeeds", async () => {
    const sleeps: number[] = [];
    const p = fakeProvider("p", async function* (_m, attempt) {
      if (attempt === 1) throw new ProviderError("rate_limited", "429");
      yield { type: "delta", text: "ok" };
    });
    const engine = new AudenEngine({ providers: new Map([["p", p]]), resolveRoute: async () => [{ provider: "p", model: "a" }], sleep: async (ms) => { sleeps.push(ms); } });
    const evs = await collect(engine.run({ mode: "air", messages: msgs, backoffBaseMs: 100 }));
    expect(types(evs)).toEqual(["route", "route", "delta", "done"]);
    expect(sleeps).toEqual([100]);
  });

  it("falls back to the next model on non-retryable errors without retrying", async () => {
    const p = fakeProvider("p", async function* (model) {
      if (model === "a") throw new ProviderError("not_allowed", "paid");
      yield { type: "delta", text: "from b" };
    });
    const engine = new AudenEngine({ providers: new Map([["p", p]]), resolveRoute: async () => [{ provider: "p", model: "a" }, { provider: "p", model: "b" }], sleep: async () => {} });
    const evs = await collect(engine.run({ mode: "air", messages: msgs }));
    expect(p.attempts).toEqual({ a: 1, b: 1 });
    expect(evs.at(-1)).toMatchObject({ type: "done", model: "b", text: "from b" });
  });

  it("does not switch models after tokens were streamed", async () => {
    const p = fakeProvider("p", async function* () {
      yield { type: "delta", text: "partial" };
      throw new ProviderError("unavailable", "boom");
    });
    const engine = new AudenEngine({ providers: new Map([["p", p]]), resolveRoute: async () => [{ provider: "p", model: "a" }, { provider: "p", model: "b" }], sleep: async () => {} });
    const evs = await collect(engine.run({ mode: "air", messages: msgs }));
    expect(evs.at(-1)).toMatchObject({ type: "error", code: "unavailable", partialText: "partial" });
    expect(p.attempts).toEqual({ a: 1 });
  });

  it("returns an error after exhausting all models", async () => {
    const p = fakeProvider("p", async function* () { throw new ProviderError("unavailable", "down"); });
    const engine = new AudenEngine({ providers: new Map([["p", p]]), resolveRoute: async () => [{ provider: "p", model: "a" }, { provider: "p", model: "b" }], sleep: async () => {} });
    const evs = await collect(engine.run({ mode: "air", messages: msgs, maxRetriesPerModel: 2 }));
    expect(p.attempts).toEqual({ a: 3, b: 3 });
    expect(evs.at(-1)).toMatchObject({ type: "error", code: "unavailable" });
  });

  it("reports no_route when nothing is configured", async () => {
    const engine = new AudenEngine({ providers: new Map(), resolveRoute: async () => [{ provider: "missing", model: "x" }] });
    expect((await collect(engine.run({ mode: "air", messages: msgs })))).toEqual([expect.objectContaining({ type: "error", code: "no_route" })]);
  });

  it("supports cancellation mid-stream and keeps partial text", async () => {
    const ctrl = new AbortController();
    const engine = new AudenEngine({ providers: new Map([["mock", new MockProvider({ delayMs: 5 })]]), resolveRoute: async () => [{ provider: "mock", model: "m" }] });
    const evs: EngineEvent[] = [];
    for await (const e of engine.run({ mode: "air", messages: msgs, signal: ctrl.signal })) {
      evs.push(e);
      if (e.type === "delta" && evs.filter((x) => x.type === "delta").length === 3) ctrl.abort();
    }
    const last = evs.at(-1)!;
    expect(last).toMatchObject({ type: "error", code: "cancelled" });
    expect((last as { partialText: string }).partialText.length).toBeGreaterThan(0);
  });

  it("times out when the first token does not arrive", async () => {
    const p = fakeProvider("p", async function* (_m, _a, signal) {
      await new Promise((_r, rej) => signal?.addEventListener("abort", () => rej(new ProviderError("cancelled", "aborted"))));
      yield { type: "delta", text: "never" };
    });
    const engine = new AudenEngine({ providers: new Map([["p", p]]), resolveRoute: async () => [{ provider: "p", model: "a" }], sleep: async () => {} });
    const evs = await collect(engine.run({ mode: "air", messages: msgs, firstTokenTimeoutMs: 20, maxRetriesPerModel: 0 }));
    expect(evs.at(-1)).toMatchObject({ type: "error", code: "timeout" });
  });
});
