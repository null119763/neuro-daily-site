/**
 * Auden Core Engine — shared types.
 * Core is framework-agnostic: no imports from Next.js, React or persistence.
 */

export type Role = "system" | "user" | "assistant";

export interface ChatMessage {
  role: Role;
  content: string;
}

/** Routing modes. These are routes over provider models, not Auden-owned weights. */
export const MODES = ["air", "core", "prime"] as const;
export type Mode = (typeof MODES)[number];

export function isMode(value: unknown): value is Mode {
  return typeof value === "string" && (MODES as readonly string[]).includes(value);
}

export interface ModelRef {
  provider: string;
  model: string;
}

export interface ModelInfo extends ModelRef {
  label: string;
  contextTokens: number;
  /** USD per 1M tokens. 0 for free models. */
  inputPricePerM: number;
  outputPricePerM: number;
}

export interface ProviderCapabilities {
  streaming: boolean;
  maxContextTokens: number;
  vision: boolean;
  tools: boolean;
}

export interface StreamRequest {
  model: string;
  messages: ChatMessage[];
  maxOutputTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

export type StreamChunk =
  | { type: "delta"; text: string }
  | { type: "usage"; inputTokens: number; outputTokens: number; costUsd?: number };

export interface ModelProvider {
  /** Stable id stored with every message, e.g. "openrouter", "mock", "custom". */
  readonly id: string;
  readonly label: string;
  isConfigured(): boolean;
  listModels(): Promise<ModelInfo[]>;
  capabilities(model: string): Promise<ProviderCapabilities>;
  /** Estimated cost in USD. Must return 0 for free models. */
  estimateCost(model: string, inputTokens: number, outputTokens: number): Promise<number>;
  /** Throws ProviderError if the model is not allowed (e.g. paid model while paid usage is disabled). */
  assertAllowed(model: string): Promise<void>;
  stream(request: StreamRequest): AsyncIterable<StreamChunk>;
}

export type ProviderErrorCode =
  | "auth"
  | "rate_limited"
  | "quota"
  | "unavailable"
  | "bad_request"
  | "timeout"
  | "cancelled"
  | "not_allowed"
  | "content_filtered"
  | "unknown";

const RETRYABLE: ReadonlySet<ProviderErrorCode> = new Set(["rate_limited", "unavailable", "timeout", "unknown"]);

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly status?: number;
  readonly retryAfterMs?: number;

  constructor(code: ProviderErrorCode, message: string, opts: { status?: number; retryAfterMs?: number } = {}) {
    super(message);
    this.name = "ProviderError";
    this.code = code;
    this.status = opts.status;
    this.retryAfterMs = opts.retryAfterMs;
  }

  get retryable(): boolean {
    return RETRYABLE.has(this.code);
  }

  static fromStatus(status: number, message: string, retryAfterMs?: number): ProviderError {
    if (status === 401 || status === 403) return new ProviderError("auth", message, { status });
    if (status === 402) return new ProviderError("quota", message, { status });
    if (status === 429) return new ProviderError("rate_limited", message, { status, retryAfterMs });
    if (status === 400 || status === 404 || status === 413 || status === 422) return new ProviderError("bad_request", message, { status });
    if (status === 408) return new ProviderError("timeout", message, { status });
    if (status >= 500) return new ProviderError("unavailable", message, { status });
    return new ProviderError("unknown", message, { status });
  }
}
