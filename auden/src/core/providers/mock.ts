import { ProviderError, type ModelInfo, type ModelProvider, type StreamChunk, type StreamRequest } from "../types";
import { estimateMessagesTokens, estimateTokens } from "../tokens";

/**
 * Deterministic development provider. It does NOT call any model: responses are templated.
 * The UI labels it as "Mock (demo)" so it is never mistaken for a real model.
 *
 * Test hooks (only in the mock): a user message starting with
 *   "/mock-error <code>"  → throws ProviderError(code) before streaming
 *   "/mock-slow"          → streams slowly (for cancellation tests)
 */
export class MockProvider implements ModelProvider {
  readonly id = "mock";
  readonly label = "Mock (demo)";
  private readonly delayMs: number;
  /** Count of calls per model; used by tests. */
  readonly calls: string[] = [];

  constructor(opts: { delayMs?: number } = {}) {
    this.delayMs = opts.delayMs ?? 12;
  }

  isConfigured(): boolean {
    return true;
  }

  async listModels(): Promise<ModelInfo[]> {
    return ["mock-air", "mock-core", "mock-prime"].map((model) => ({
      provider: this.id,
      model,
      label: model,
      contextTokens: 32_000,
      inputPricePerM: 0,
      outputPricePerM: 0,
    }));
  }

  async capabilities() {
    return { streaming: true, maxContextTokens: 32_000, vision: false, tools: false };
  }

  async estimateCost() {
    return 0;
  }

  async assertAllowed() {}

  async *stream(req: StreamRequest): AsyncGenerator<StreamChunk> {
    this.calls.push(req.model);
    const last = [...req.messages].reverse().find((m) => m.role === "user")?.content ?? "";
    const errMatch = /^\/mock-error\s+(\w+)/.exec(last.trim());
    if (errMatch) throw new ProviderError(errMatch[1] as ProviderError["code"], `Mock error: ${errMatch[1]}`);
    const slow = last.trim().startsWith("/mock-slow");

    const text = buildReply(last, req.messages.find((m) => m.role === "system")?.content ?? "");
    const words = text.split(/(?<=\s)/);
    for (const w of words) {
      if (req.signal?.aborted) throw new ProviderError("cancelled", "Request cancelled");
      await sleep(slow ? 150 : this.delayMs, req.signal);
      yield { type: "delta", text: w };
    }
    yield { type: "usage", inputTokens: estimateMessagesTokens(req.messages), outputTokens: estimateTokens(text) };
  }
}

function buildReply(userText: string, system: string): string {
  const ru = /[а-яё]/i.test(userText) || (!/[a-z]/i.test(userText) && /locale: ru/.test(system));
  const topic = userText.replace(/\s+/g, " ").trim().slice(0, 120);
  if (ru) {
    return [
      `Это демонстрационный ответ **mock‑провайдера** — настоящая модель не подключена.`,
      ``,
      `Ваш запрос: «${topic}».`,
      ``,
      `Когда будет настроен ключ OpenRouter, здесь появится ответ реальной модели. Пока можно проверить:`,
      ``,
      `- потоковую выдачу и отмену;`,
      `- сохранение истории после перезагрузки;`,
      `- проекты, память и настройки.`,
    ].join("\n");
  }
  return [
    `This is a demo reply from the **mock provider** — no real model is connected.`,
    ``,
    `Your request: "${topic}".`,
    ``,
    `Once an OpenRouter key is configured, a real model will answer here. Meanwhile you can test:`,
    ``,
    `- streaming and cancellation;`,
    `- history persisting across reloads;`,
    `- projects, memory and settings.`,
  ].join("\n");
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ms <= 0) return resolve();
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new ProviderError("cancelled", "Request cancelled"));
      },
      { once: true },
    );
  });
}
