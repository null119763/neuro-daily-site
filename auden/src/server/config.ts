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
  /** open: anyone; allowlist: only AUDEN_ALLOWED_EMAILS (closed alpha); closed: no sign-ups. */
  signupMode: "open" | "allowlist" | "closed";
  /** Lowercased emails, or "@domain.com" entries for whole domains. */
  allowedEmails: string[];
  /** Trust X-Forwarded-For from the hosting proxy for per-IP auth limits. */
  trustProxy: boolean;
  auth: { failedPerEmail: number; failedPerIp: number; signupsPerIpHour: number };
}

export function isEmailAllowed(email: string, cfg: Pick<AppConfig, "signupMode" | "allowedEmails">): boolean {
  if (cfg.signupMode === "open") return true;
  if (cfg.signupMode === "closed") return false;
  const e = email.trim().toLowerCase();
  const domain = e.slice(e.lastIndexOf("@"));
  return cfg.allowedEmails.includes(e) || cfg.allowedEmails.includes(domain);
}

function signupMode(env: NodeJS.ProcessEnv): AppConfig["signupMode"] {
  const m = env.AUDEN_SIGNUP_MODE?.trim().toLowerCase();
  if (m === "open" || m === "allowlist" || m === "closed") return m;
  // Backward compatibility with AUDEN_SIGNUPS_OPEN=false
  return env.AUDEN_SIGNUPS_OPEN === "false" ? "closed" : "open";
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
    signupMode: signupMode(env),
    allowedEmails: (env.AUDEN_ALLOWED_EMAILS ?? "")
      .split(",")
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean),
    trustProxy: env.AUDEN_TRUST_PROXY !== "false",
    auth: {
      failedPerEmail: int("AUDEN_AUTH_FAILS_PER_EMAIL", 5, env),
      failedPerIp: int("AUDEN_AUTH_FAILS_PER_IP", 30, env),
      signupsPerIpHour: int("AUDEN_SIGNUPS_PER_IP_HOUR", 5, env),
    },
  };
}
