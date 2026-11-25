import { describe, expect, it } from "vitest";
import { OpenAICompatibleProvider } from "@/core/providers/openai-compatible";
import { OpenRouterProvider, autoSelectChains, paramsBillions } from "@/core/providers/openrouter";
import { parseSSE } from "@/core/providers/sse";
import { ProviderError, type ModelInfo } from "@/core/types";
import { chunk, collect, sseResponse } from "./helpers";

const freeModel: ModelInfo = { provider: "custom", model: "m", label: "m", contextTokens: 8000, inputPricePerM: 0, outputPricePerM: 0 };

describe("parseSSE", () => {
  it("handles split chunks, comments and CRLF", async () => {
    const enc = new TextEncoder();
    const parts = [": keep-alive\n\n", "data: {\"a\"", ":1}\n\ndata: x\r\n\r\n", "data: [DONE]\n\n"];
    const body = new ReadableStream<Uint8Array>({ start(c) { parts.forEach((p) => c.enqueue(enc.encode(p))); c.close(); } });
    expect(await collect(parseSSE(body))).toEqual(['{"a":1}', "x", "[DONE]"]);
  });
});

describe("OpenAICompatibleProvider", () => {
  it("streams deltas and usage", async () => {
    let sentBody: Record<string, unknown> = {};
    const p = new OpenAICompatibleProvider({
      id: "custom", label: "c", baseUrl: "http://x/v1", models: [freeModel], apiKey: "k",
      fetchImpl: async (_u, init) => {
        sentBody = JSON.parse(String(init?.body));
        expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer k");
        return sseResponse([chunk("Hel"), chunk("lo"), `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 5, completion_tokens: 2 } })}\n\n`, "data: [DONE]\n\n"]);
      },
    });
    const out = await collect(p.stream({ model: "m", messages: [{ role: "user", content: "hi" }] }));
    expect(out).toEqual([{ type: "delta", text: "Hel" }, { type: "delta", text: "lo" }, { type: "usage", inputTokens: 5, outputTokens: 2, costUsd: undefined }]);
    expect(sentBody.stream).toBe(true);
  });

  it("maps HTTP 429 to a retryable rate_limited error with retry-after", async () => {
    const p = new OpenAICompatibleProvider({
      id: "custom", label: "c", baseUrl: "http://x/v1", models: [freeModel],
      fetchImpl: async () => new Response(JSON.stringify({ error: { message: "slow down" } }), { status: 429, headers: { "retry-after": "2" } }),
    });
    const err = await collect(p.stream({ model: "m", messages: [] })).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.code).toBe("rate_limited");
    expect(err.retryable).toBe(true);
    expect(err.retryAfterMs).toBe(2000);
    expect(err.message).toBe("slow down");
  });

  it("surfaces in-stream errors", async () => {
    const p = new OpenAICompatibleProvider({
      id: "custom", label: "c", baseUrl: "http://x/v1", models: [freeModel],
      fetchImpl: async () => sseResponse([chunk("a"), `data: ${JSON.stringify({ error: { code: 502, message: "upstream" } })}\n\n`]),
    });
    const got: unknown[] = [];
    const err = await (async () => { for await (const c of p.stream({ model: "m", messages: [] })) got.push(c); })().catch((e) => e);
    expect(got).toHaveLength(1);
    expect(err.code).toBe("unavailable");
  });

  it("refuses paid models when paid usage is disabled", async () => {
    let called = false;
    const p = new OpenAICompatibleProvider({
      id: "custom", label: "c", baseUrl: "http://x/v1",
      models: [{ ...freeModel, model: "paid", inputPricePerM: 1 }],
      fetchImpl: async () => { called = true; return sseResponse([]); },
    });
    const err = await collect(p.stream({ model: "paid", messages: [] })).catch((e) => e);
    expect(err.code).toBe("not_allowed");
    expect(called).toBe(false);
    expect(await p.estimateCost("paid", 1_000_000, 0)).toBe(1);
  });
});

describe("OpenRouterProvider", () => {
  const catalog = { data: [
    { id: "meta/llama-70b-instruct:free", context_length: 128000, pricing: { prompt: "0", completion: "0" } },
    { id: "zero/price-8b", context_length: 32000, pricing: { prompt: "0", completion: "0" } },
    { id: "openai/gpt-paid", context_length: 128000, pricing: { prompt: "0.000002", completion: "0.000008" } },
  ] };
  const p = new OpenRouterProvider({ apiKey: "k", fetchImpl: async () => new Response(JSON.stringify(catalog)) });

  it("is configured only with a key", () => {
    expect(new OpenRouterProvider({}).isConfigured()).toBe(false);
    expect(p.isConfigured()).toBe(true);
  });
  it("accepts :free and zero-priced models, rejects paid", async () => {
    await expect(p.assertAllowed("anything:free")).resolves.toBeUndefined();
    await expect(p.assertAllowed("zero/price-8b")).resolves.toBeUndefined();
    await expect(p.assertAllowed("openai/gpt-paid")).rejects.toMatchObject({ code: "not_allowed" });
    await expect(p.assertAllowed("unknown/model")).rejects.toMatchObject({ code: "not_allowed" });
    expect((await p.listFreeModels()).map((m) => m.model)).toEqual(["meta/llama-70b-instruct:free", "zero/price-8b"]);
  });
});

describe("autoSelectChains", () => {
  it("orders by size per mode", () => {
    expect(paramsBillions("meta-llama/llama-3.3-70b-instruct:free")).toBe(70);
    expect(paramsBillions("google/gemma-3-4b-it:free")).toBe(4);
    const mk = (model: string): ModelInfo => ({ ...freeModel, model });
    const chains = autoSelectChains([mk("a-4b:free"), mk("b-70b:free"), mk("c-27b:free"), mk("d-405b:free"), mk("e-embed-1b:free")]);
    expect(chains.air[0]).toBe("a-4b:free");
    expect(chains.prime[0]).toBe("d-405b:free");
    expect(chains.core[0]).toBe("b-70b:free");
    expect(Object.values(chains).flat()).not.toContain("e-embed-1b:free");
  });
});
