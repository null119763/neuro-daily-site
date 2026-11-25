"use client";
import type { ChatStreamEvent } from "@/server/chat-service";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message?: string,
    readonly retryAfterSec?: number,
  ) {
    super(message ?? code);
  }
}

async function toApiError(res: Response): Promise<ApiError> {
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string; retryAfterSec?: number } };
    return new ApiError(res.status, body.error?.code ?? "generic", body.error?.message, body.error?.retryAfterSec);
  } catch {
    return new ApiError(res.status, res.status === 401 ? "unauthorized" : "generic");
  }
}

export async function api<T>(path: string, opts: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/${path}`, {
      method: opts.method ?? "GET",
      headers: opts.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
      credentials: "same-origin",
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError(0, "network");
  }
  if (!res.ok) throw await toApiError(res);
  return (await res.json()) as T;
}

/** POST /api/chat and yield parsed SSE events. */
export async function* streamChat(body: Record<string, unknown>, signal: AbortSignal): AsyncGenerator<ChatStreamEvent> {
  let res: Response;
  try {
    res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
      credentials: "same-origin",
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") return;
    throw new ApiError(0, "network");
  }
  if (!res.ok || !res.body) throw await toApiError(res);

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf("\n\n")) !== -1) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const line = block.split("\n").find((l) => l.startsWith("data: "));
        if (line) yield JSON.parse(line.slice(6)) as ChatStreamEvent;
      }
    }
  } catch (e) {
    if ((e as Error).name === "AbortError") return;
    throw new ApiError(0, "network");
  }
}
