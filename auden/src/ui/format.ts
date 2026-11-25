import type { Locale } from "@/domain/types";

export function dayGroup(iso: string, now = new Date()): "today" | "yesterday" | "earlier" {
  const d = new Date(iso);
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (d.getTime() >= start) return "today";
  if (d.getTime() >= start - 86_400_000) return "yesterday";
  return "earlier";
}

export function shortTime(iso: string, locale: Locale, now = new Date()): string {
  const d = new Date(iso);
  const tag = locale === "ru" ? "ru-RU" : "en-GB";
  if (dayGroup(iso, now) === "today") return d.toLocaleTimeString(tag, { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString(tag, { day: "numeric", month: "short" });
}

export function modelLabel(provider: string | null, model: string | null): string {
  if (!provider || !model) return "";
  if (provider === "mock") return "Mock (demo)";
  const short = model.replace(/:free$/, "").split("/").pop() ?? model;
  const via = provider === "openrouter" ? "OpenRouter" : provider === "custom" ? "self-hosted" : provider;
  return `${short} · ${via}`;
}
