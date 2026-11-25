import { OpenAICompatibleProvider, type FetchLike } from "./openai-compatible";
import type { ModelInfo } from "../types";

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

export interface OpenRouterOptions {
  apiKey?: string;
  appUrl?: string;
  appName?: string;
  fetchImpl?: FetchLike;
  now?: () => number;
}

/**
 * OpenRouter provider. Alpha policy: free models only.
 * A model counts as free when its id ends with ":free" or the catalogue lists zero price.
 */
export class OpenRouterProvider extends OpenAICompatibleProvider {
  constructor(opts: OpenRouterOptions) {
    const extraHeaders: Record<string, string> = { "X-Title": opts.appName ?? "Auden" };
    if (opts.appUrl) extraHeaders["HTTP-Referer"] = opts.appUrl;
    super({
      id: "openrouter",
      label: "OpenRouter",
      baseUrl: OPENROUTER_BASE_URL,
      apiKey: opts.apiKey,
      extraHeaders,
      fetchImpl: opts.fetchImpl,
      allowPaid: false,
      now: opts.now,
    });
  }

  override isConfigured(): boolean {
    return Boolean(this.opts.apiKey);
  }

  override async isFree(model: string): Promise<boolean> {
    if (model.endsWith(":free")) return true;
    return super.isFree(model);
  }

  /** Free models from the live catalogue, best candidates first. */
  async listFreeModels(): Promise<ModelInfo[]> {
    const all = await this.listModels();
    return all.filter((m) => m.model.endsWith(":free") || (m.inputPricePerM === 0 && m.outputPricePerM === 0));
  }
}

/** Parse parameter count in billions from ids like "meta-llama/llama-3.3-70b-instruct:free". */
export function paramsBillions(modelId: string): number | null {
  const m = /(\d+(?:\.\d+)?)b(?![a-z])/i.exec(modelId.replace(/:free$/, ""));
  return m ? Number(m[1]) : null;
}

/**
 * Pick model chains for modes from a list of free models when no explicit config is given.
 * Air prefers small fast models, Prime prefers the largest, Core sits in between.
 * Models with unknown size are treated as mid-size.
 */
export function autoSelectChains(free: ModelInfo[], perMode = 3): Record<"air" | "core" | "prime", string[]> {
  const sized = free
    .filter((m) => !/embed|guard|moderation|vision-only|tts|whisper/i.test(m.model))
    .map((m) => ({ id: m.model, size: paramsBillions(m.model) ?? 30, ctx: m.contextTokens }));
  const bySizeAsc = [...sized].sort((a, b) => a.size - b.size || b.ctx - a.ctx);
  const bySizeDesc = [...bySizeAsc].reverse();
  const air = bySizeAsc.filter((m) => m.size >= 3).slice(0, perMode).map((m) => m.id);
  const prime = bySizeDesc.slice(0, perMode).map((m) => m.id);
  const mid = bySizeAsc.filter((m) => m.size >= 12 && m.size <= 80);
  const core = (mid.length ? mid.reverse() : bySizeDesc).slice(0, perMode).map((m) => m.id);
  return { air, core, prime };
}
