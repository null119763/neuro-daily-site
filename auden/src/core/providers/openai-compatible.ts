import { parseSSE } from "./sse";
import {
  ProviderError,
  type ModelInfo,
  type ModelProvider,
  type ProviderCapabilities,
  type StreamChunk,
  type StreamRequest,
} from "../types";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface OpenAICompatibleOptions {
  id: string;
  label: string;
  /** e.g. https://openrouter.ai/api/v1 or http://localhost:8000/v1 (vLLM) */
  baseUrl: string;
  apiKey?: string;
  /** Static model list. If omitted, models are discovered via GET {baseUrl}/models. */
  models?: ModelInfo[];
  extraHeaders?: Record<string, string>;
  fetchImpl?: FetchLike;
  /** Paid usage switch. Auden alpha keeps this false: only zero-price models are allowed. */
  allowPaid?: boolean;
  /** Cache TTL for the discovered model catalogue. */
  catalogTtlMs?: number;
  now?: () => number;
}

interface CatalogEntry {
  id: string;
  name?: string;
  context_length?: number;
  pricing?: { prompt?: string | number; completion?: string | number };
}

/**
 * Provider for any OpenAI-compatible Chat Completions API.
 * This is the extension point for Auden's own models: vLLM, TGI, Ollama and LM Studio all expose this API.
 */
export class OpenAICompatibleProvider implements ModelProvider {
  readonly id: string;
  readonly label: string;
  protected readonly opts: OpenAICompatibleOptions;
  private catalog: { at: number; models: ModelInfo[] } | null = null;

  constructor(opts: OpenAICompatibleOptions) {
    this.opts = opts;
    this.id = opts.id;
    this.label = opts.label;
  }

  protected get fetch(): FetchLike {
    return this.opts.fetchImpl ?? ((input, init) => fetch(input, init));
  }

  protected now(): number {
    return this.opts.now ? this.opts.now() : Date.now();
  }

  isConfigured(): boolean {
    return Boolean(this.opts.baseUrl);
  }

  protected headers(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json", ...this.opts.extraHeaders };
    if (this.opts.apiKey) h.Authorization = `Bearer ${this.opts.apiKey}`;
    return h;
  }

  async listModels(): Promise<ModelInfo[]> {
    if (this.opts.models) return this.opts.models;
    const ttl = this.opts.catalogTtlMs ?? 60 * 60 * 1000;
    if (this.catalog && this.now() - this.catalog.at < ttl) return this.catalog.models;
    const res = await this.fetch(`${this.opts.baseUrl}/models`, { headers: this.headers() });
    if (!res.ok) throw ProviderError.fromStatus(res.status, `Model catalogue request failed (${res.status})`);
    const json = (await res.json()) as { data?: CatalogEntry[] };
    const models = (json.data ?? []).map((m) => this.toModelInfo(m));
    this.catalog = { at: this.now(), models };
    return models;
  }

  protected toModelInfo(m: CatalogEntry): ModelInfo {
    const price = (v: string | number | undefined) => (v === undefined ? 0 : Number(v) * 1_000_000);
    return {
      provider: this.id,
      model: m.id,
      label: m.name ?? m.id,
      contextTokens: m.context_length ?? 8192,
      inputPricePerM: price(m.pricing?.prompt),
      outputPricePerM: price(m.pricing?.completion),
    };
  }

  protected async findModel(model: string): Promise<ModelInfo | undefined> {
    try {
      return (await this.listModels()).find((m) => m.model === model);
    } catch {
      return undefined;
    }
  }

  async capabilities(model: string): Promise<ProviderCapabilities> {
    const info = await this.findModel(model);
    return { streaming: true, maxContextTokens: info?.contextTokens ?? 8192, vision: false, tools: false };
  }

  async estimateCost(model: string, inputTokens: number, outputTokens: number): Promise<number> {
    const info = await this.findModel(model);
    if (!info) return 0;
    return (inputTokens * info.inputPricePerM + outputTokens * info.outputPricePerM) / 1_000_000;
  }

  /** A model is free when the catalogue lists zero price. Subclasses may add rules. */
  async isFree(model: string): Promise<boolean> {
    const info = await this.findModel(model);
    return info !== undefined && info.inputPricePerM === 0 && info.outputPricePerM === 0;
  }

  async assertAllowed(model: string): Promise<void> {
    if (this.opts.allowPaid) return;
    if (!(await this.isFree(model))) {
      throw new ProviderError("not_allowed", `Model ${model} is not a verified free model; paid usage is disabled.`);
    }
  }

  async *stream(req: StreamRequest): AsyncGenerator<StreamChunk> {
    await this.assertAllowed(req.model);
    let res: Response;
    try {
      res = await this.fetch(`${this.opts.baseUrl}/chat/completions`, {
        method: "POST",
        headers: this.headers(),
        signal: req.signal,
        body: JSON.stringify({
          model: req.model,
          messages: req.messages,
          stream: true,
          stream_options: { include_usage: true },
          ...(req.maxOutputTokens ? { max_tokens: req.maxOutputTokens } : {}),
          ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        }),
      });
    } catch (err) {
      if (req.signal?.aborted) throw new ProviderError("cancelled", "Request cancelled");
      throw new ProviderError("unavailable", `Network error: ${(err as Error).message}`);
    }

    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      const retryAfter = Number(res.headers.get("retry-after"));
      throw ProviderError.fromStatus(
        res.status,
        extractErrorMessage(text) ?? `Provider responded with ${res.status}`,
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined,
      );
    }

    try {
      for await (const data of parseSSE(res.body, req.signal)) {
        if (data === "[DONE]") break;
        let json: StreamPayload;
        try {
          json = JSON.parse(data) as StreamPayload;
        } catch {
          continue;
        }
        if (json.error) {
          const code = typeof json.error.code === "number" ? json.error.code : 500;
          throw ProviderError.fromStatus(code, json.error.message ?? "Provider stream error");
        }
        const choice = json.choices?.[0];
        const text = choice?.delta?.content;
        if (text) yield { type: "delta", text };
        if (choice?.finish_reason === "content_filter") {
          throw new ProviderError("content_filtered", "The provider filtered this response.");
        }
        if (json.usage) {
          yield {
            type: "usage",
            inputTokens: json.usage.prompt_tokens ?? 0,
            outputTokens: json.usage.completion_tokens ?? 0,
            costUsd: typeof json.usage.cost === "number" ? json.usage.cost : undefined,
          };
        }
      }
    } catch (err) {
      if (req.signal?.aborted) throw new ProviderError("cancelled", "Request cancelled");
      if (err instanceof ProviderError) throw err;
      throw new ProviderError("unavailable", `Stream interrupted: ${(err as Error).message}`);
    }
    if (req.signal?.aborted) throw new ProviderError("cancelled", "Request cancelled");
  }
}

interface StreamPayload {
  choices?: { delta?: { content?: string | null }; finish_reason?: string | null }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
  error?: { code?: number | string; message?: string };
}

function extractErrorMessage(text: string): string | undefined {
  try {
    const json = JSON.parse(text) as { error?: { message?: string } };
    return json.error?.message;
  } catch {
    return text ? text.slice(0, 300) : undefined;
  }
}
