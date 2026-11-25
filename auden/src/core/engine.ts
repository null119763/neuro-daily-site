import { estimateMessagesTokens, estimateTokens } from "./tokens";
import { ProviderError, type ChatMessage, type Mode, type ModelProvider, type ModelRef, type ProviderErrorCode } from "./types";

export interface EngineDeps {
  providers: ReadonlyMap<string, ModelProvider>;
  /** Ordered fallback chain for a mode. Only routes that are allowed (free) may be returned. */
  resolveRoute(mode: Mode): Promise<ModelRef[]>;
  sleep?: (ms: number) => Promise<void>;
}

export interface RunParams {
  mode: Mode;
  messages: ChatMessage[];
  signal?: AbortSignal;
  maxOutputTokens?: number;
  temperature?: number;
  /** Retries per model for retryable errors that happen before the first token. */
  maxRetriesPerModel?: number;
  firstTokenTimeoutMs?: number;
  totalTimeoutMs?: number;
  backoffBaseMs?: number;
}

export type EngineEvent =
  | { type: "route"; provider: string; model: string; attempt: number }
  | { type: "delta"; text: string }
  | {
      type: "done";
      provider: string;
      model: string;
      text: string;
      inputTokens: number;
      outputTokens: number;
      costUsd: number;
      usageEstimated: boolean;
    }
  | {
      type: "error";
      code: ProviderErrorCode | "no_route";
      message: string;
      provider?: string;
      model?: string;
      partialText: string;
      inputTokens: number;
      outputTokens: number;
    };

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Auden Core Engine: routes a request over a fallback chain of models,
 * streams deltas, retries with exponential backoff before the first token,
 * enforces timeouts and cancellation, and reports usage.
 * It never throws: all failures are returned as an "error" event.
 */
export class AudenEngine {
  constructor(private readonly deps: EngineDeps) {}

  async *run(params: RunParams): AsyncGenerator<EngineEvent> {
    const sleep = this.deps.sleep ?? defaultSleep;
    const maxRetries = params.maxRetriesPerModel ?? 1;
    const backoff = params.backoffBaseMs ?? 600;
    const estimatedInput = estimateMessagesTokens(params.messages);

    let route: ModelRef[];
    try {
      route = await this.deps.resolveRoute(params.mode);
    } catch (err) {
      route = [];
      void err;
    }
    route = route.filter((r) => this.deps.providers.get(r.provider)?.isConfigured());
    if (route.length === 0) {
      yield { type: "error", code: "no_route", message: "No model is available for this mode.", partialText: "", inputTokens: 0, outputTokens: 0 };
      return;
    }

    let lastError: ProviderError | null = null;
    let attemptNo = 0;

    for (const ref of route) {
      const provider = this.deps.providers.get(ref.provider)!;
      for (let retry = 0; retry <= maxRetries; retry++) {
        if (params.signal?.aborted) {
          yield this.errorEvent(new ProviderError("cancelled", "Request cancelled"), ref, "", 0, 0);
          return;
        }
        attemptNo++;
        yield { type: "route", provider: ref.provider, model: ref.model, attempt: attemptNo };

        const ctrl = new AbortController();
        let timedOut = false;
        const onAbort = () => ctrl.abort();
        params.signal?.addEventListener("abort", onAbort, { once: true });
        const totalTimer = setTimeout(() => {
          timedOut = true;
          ctrl.abort();
        }, params.totalTimeoutMs ?? 120_000);
        let firstTimer: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
          timedOut = true;
          ctrl.abort();
        }, params.firstTokenTimeoutMs ?? 30_000);

        let text = "";
        let usage: { inputTokens: number; outputTokens: number; costUsd?: number } | null = null;
        try {
          for await (const chunk of provider.stream({
            model: ref.model,
            messages: params.messages,
            maxOutputTokens: params.maxOutputTokens,
            temperature: params.temperature,
            signal: ctrl.signal,
          })) {
            if (chunk.type === "delta") {
              if (firstTimer) {
                clearTimeout(firstTimer);
                firstTimer = undefined;
              }
              text += chunk.text;
              yield { type: "delta", text: chunk.text };
            } else {
              usage = chunk;
            }
          }
          if (ctrl.signal.aborted) throw new ProviderError("cancelled", "Request cancelled");
          const inputTokens = usage?.inputTokens || estimatedInput;
          const outputTokens = usage?.outputTokens || estimateTokens(text);
          const costUsd = usage?.costUsd ?? (await provider.estimateCost(ref.model, inputTokens, outputTokens));
          yield {
            type: "done",
            provider: ref.provider,
            model: ref.model,
            text,
            inputTokens,
            outputTokens,
            costUsd,
            usageEstimated: !usage,
          };
          return;
        } catch (raw) {
          let err = raw instanceof ProviderError ? raw : new ProviderError("unknown", (raw as Error)?.message ?? "Unknown error");
          if (timedOut && !params.signal?.aborted) err = new ProviderError("timeout", "The model took too long to respond.");
          if (params.signal?.aborted) err = new ProviderError("cancelled", "Request cancelled");
          lastError = err;

          // Once tokens were streamed we cannot transparently switch models: report with partial text.
          if (text.length > 0 || err.code === "cancelled") {
            yield this.errorEvent(err, ref, text, estimatedInput, estimateTokens(text));
            return;
          }
          // Non-retryable errors (auth, not_allowed, bad_request, quota) skip to the next model.
          if (!err.retryable) break;
          if (retry < maxRetries) {
            const wait = Math.min(err.retryAfterMs ?? backoff * 2 ** retry, 8_000);
            await sleep(wait);
          }
        } finally {
          clearTimeout(totalTimer);
          if (firstTimer) clearTimeout(firstTimer);
          params.signal?.removeEventListener("abort", onAbort);
        }
      }
    }

    yield this.errorEvent(lastError ?? new ProviderError("unknown", "All models failed"), route[route.length - 1]!, "", 0, 0);
  }

  private errorEvent(err: ProviderError, ref: ModelRef, partialText: string, inputTokens: number, outputTokens: number): EngineEvent {
    return { type: "error", code: err.code, message: err.message, provider: ref.provider, model: ref.model, partialText, inputTokens, outputTokens };
  }
}
