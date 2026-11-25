import { parseModelList } from "@/core/router";
import { isMode, type Mode, type ModelRef } from "@/core/types";
import type { QuotaLimits } from "@/core/quota";

export interface AppConfig {
  backend: "local" | "supabase";
  localDataFile: string | null;
  supabaseUrl: string | null;
  supabaseAnonKey: string | null;
  openrouterKey: string | null;
  appUrl: string | null;
  explicitModels: Partial<Record<Mode, ModelRef[]>>;
  custom: { baseUrl: string; apiKey: string | null; models: string[]; modes: Mode[] } | null;
  limits: QuotaLimits;
  maxInputChars: number;
  maxContextTokens: number;
  maxOutputTokens: number;
  signupsOpen: boolean;
}

function int(name: string, fallback: number, env: NodeJS.ProcessEnv): number {
  const v = Number(env[name]);
  return Number.isFinite(v) && v >= 0 ? Math.floor(v) : fallback;
}

/** Reads configuration from environment variables. Secrets are never logged or sent to the client. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const backend = env.AUDEN_BACKEND === "supabase" ? "supabase" : "local";
  const customBase = env.AUDEN_CUSTOM_BASE_URL?.trim();
  return {
    backend,
    localDataFile: env.AUDEN_LOCAL_DATA_FILE === "memory" ? null : (env.AUDEN_LOCAL_DATA_FILE || ".data/auden-dev.json"),
    supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL || null,
    supabaseAnonKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY || null,
    openrouterKey: env.OPENROUTER_API_KEY || null,
    appUrl: env.AUDEN_APP_URL || null,
    explicitModels: {
      air: parseModelList(env.AUDEN_MODELS_AIR),
      core: parseModelList(env.AUDEN_MODELS_CORE),
      prime: parseModelList(env.AUDEN_MODELS_PRIME),
    },
    custom: customBase
      ? {
          baseUrl: customBase.replace(/\/$/, ""),
          apiKey: env.AUDEN_CUSTOM_API_KEY || null,
          models: (env.AUDEN_CUSTOM_MODELS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
          modes: (env.AUDEN_CUSTOM_MODES ?? "").split(",").map((s) => s.trim()).filter(isMode),
        }
      : null,
    limits: {
      userPerMinute: int("AUDEN_USER_PER_MINUTE", 6, env),
      userPerDay: int("AUDEN_USER_DAILY_MESSAGES", 40, env),
      globalPerDay: int("AUDEN_GLOBAL_DAILY_REQUESTS", 45, env),
      globalCostPerDayUsd: 0,
    },
    maxInputChars: int("AUDEN_MAX_INPUT_CHARS", 8000, env),
    maxContextTokens: int("AUDEN_MAX_CONTEXT_TOKENS", 6000, env),
    maxOutputTokens: int("AUDEN_MAX_OUTPUT_TOKENS", 1500, env),
    signupsOpen: env.AUDEN_SIGNUPS_OPEN !== "false",
  };
}
