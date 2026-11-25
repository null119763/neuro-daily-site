import { AudenEngine } from "@/core/engine";
import { MockProvider } from "@/core/providers/mock";
import { OpenAICompatibleProvider } from "@/core/providers/openai-compatible";
import { OpenRouterProvider } from "@/core/providers/openrouter";
import { createRouteResolver } from "@/core/router";
import type { ModelProvider } from "@/core/types";
import { LocalBackend, SupabaseBackend, type Backend } from "./backend";
import { loadConfig, type AppConfig } from "./config";
import { AuthThrottle } from "./rate-limit";

export interface Runtime {
  config: AppConfig;
  backend: Backend;
  providers: Map<string, ModelProvider>;
  engine: AudenEngine;
  resolveRoute: ReturnType<typeof createRouteResolver>;
  authThrottle: AuthThrottle;
}

export function createRuntime(
  config: AppConfig,
  overrides: { backend?: Backend; providers?: Map<string, ModelProvider>; authThrottle?: AuthThrottle } = {},
): Runtime {
  const backend = overrides.backend ?? (config.backend === "supabase" ? new SupabaseBackend(config) : new LocalBackend(config));
  const providers =
    overrides.providers ??
    new Map<string, ModelProvider>([
      ["mock", new MockProvider()],
      ["openrouter", new OpenRouterProvider({ apiKey: config.openrouterKey ?? undefined, appUrl: config.appUrl ?? undefined })],
    ]);
  if (!overrides.providers && config.custom) {
    // Self-hosted OpenAI-compatible server (own weights). Treated as free: the owner runs it.
    providers.set(
      "custom",
      new OpenAICompatibleProvider({
        id: "custom",
        label: "Auden (self-hosted)",
        baseUrl: config.custom.baseUrl,
        apiKey: config.custom.apiKey ?? undefined,
        models: config.custom.models.map((model) => ({ provider: "custom", model, label: model, contextTokens: 8192, inputPricePerM: 0, outputPricePerM: 0 })),
      }),
    );
  }
  const resolveRoute = createRouteResolver(providers, {
    explicit: config.explicitModels,
    customFirstModes: config.custom?.modes ?? [],
    customModels: config.custom?.models ?? [],
  });
  return {
    config,
    backend,
    providers,
    engine: new AudenEngine({ providers, resolveRoute }),
    resolveRoute,
    authThrottle:
      overrides.authThrottle ??
      new AuthThrottle({
        failedPerEmail: { max: config.auth.failedPerEmail, windowMs: 15 * 60_000 },
        failedPerIp: { max: config.auth.failedPerIp, windowMs: 15 * 60_000 },
        signupsPerIp: { max: config.auth.signupsPerIpHour, windowMs: 60 * 60_000 },
      }),
  };
}

const g = globalThis as unknown as { __audenRuntime?: Runtime };

/** Process-wide runtime (survives Next.js dev hot reloads). */
export function getRuntime(): Runtime {
  if (!g.__audenRuntime) g.__audenRuntime = createRuntime(loadConfig());
  return g.__audenRuntime;
}
