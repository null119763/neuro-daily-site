import { autoSelectChains, OpenRouterProvider } from "./providers/openrouter";
import type { Mode, ModelProvider, ModelRef } from "./types";

export interface RouterConfig {
  /** Explicit chains per mode: "provider:model" or bare OpenRouter ids. */
  explicit: Partial<Record<Mode, ModelRef[]>>;
  /** Modes that should try the custom (self-hosted) provider first. */
  customFirstModes: Mode[];
  customModels: string[];
}

/**
 * Builds the mode → model chain resolver.
 * Priority: custom self-hosted models (if configured for the mode) → explicit config → auto-selected free
 * OpenRouter models → mock (only when no real provider is configured at all).
 */
export function createRouteResolver(providers: ReadonlyMap<string, ModelProvider>, cfg: RouterConfig) {
  const openrouter = providers.get("openrouter") as OpenRouterProvider | undefined;
  const custom = providers.get("custom");
  let autoCache: { at: number; chains: Record<Mode, string[]> } | null = null;

  async function auto(mode: Mode): Promise<string[]> {
    if (!openrouter?.isConfigured()) return [];
    if (!autoCache || Date.now() - autoCache.at > 60 * 60 * 1000) {
      const free = await openrouter.listFreeModels();
      autoCache = { at: Date.now(), chains: autoSelectChains(free) };
    }
    return autoCache.chains[mode];
  }

  return async function resolveRoute(mode: Mode): Promise<ModelRef[]> {
    const chain: ModelRef[] = [];
    if (custom?.isConfigured() && cfg.customFirstModes.includes(mode)) {
      for (const model of cfg.customModels) chain.push({ provider: "custom", model });
    }
    const explicit = cfg.explicit[mode];
    if (explicit?.length) chain.push(...explicit);
    else {
      try {
        for (const model of await auto(mode)) chain.push({ provider: "openrouter", model });
      } catch {
        // Catalogue unavailable: fall through. Explicit config is recommended for production.
      }
    }
    const usable = chain.filter((r) => providers.get(r.provider)?.isConfigured());
    if (usable.length === 0 && !openrouter?.isConfigured() && !custom?.isConfigured() && providers.has("mock")) {
      return [{ provider: "mock", model: `mock-${mode}` }];
    }
    return usable;
  };
}

export function parseModelList(value: string | undefined, defaultProvider = "openrouter"): ModelRef[] {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const m = /^(custom|openrouter|mock)::(.+)$/.exec(s);
      return m ? { provider: m[1]!, model: m[2]! } : { provider: defaultProvider, model: s };
    });
}
