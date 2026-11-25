"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, CreditCard, Download, Mic, Plug } from "lucide-react";
import type { Mode } from "@/core/types";
import type { Locale, ThemePref } from "@/domain/types";
import { useApp } from "../app-context";
import { api, ApiError } from "../api-client";
import { errorText } from "../i18n";
import { modelLabel } from "../format";
import { MenuButton } from "./AppShell";

interface UsageInfo {
  today: { requests: number; inputTokens: number; outputTokens: number };
  limits: { perDay: number; perMinute: number };
}
interface ModelsInfo {
  modes: { mode: Mode; route: { provider: string; model: string }[] }[];
  providers: { id: string; label: string; configured: boolean }[];
}

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

export function SettingsView() {
  const app = useApp();
  const { t, locale, profile, user, backend } = app;
  const router = useRouter();
  const [name, setName] = useState(profile.displayName ?? "");
  const [instructions, setInstructions] = useState(profile.customInstructions ?? "");
  const [usage, setUsage] = useState<UsageInfo | null>(null);
  const [models, setModels] = useState<ModelsInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    api<UsageInfo>("usage").then(setUsage).catch(() => undefined);
    api<ModelsInfo>("models").then(setModels).catch(() => undefined);
  }, []);

  async function save(patch: Parameters<typeof app.updateProfile>[0], tag: string) {
    setError(null);
    try {
      await app.updateProfile(patch);
      setSaved(tag);
      setTimeout(() => setSaved(null), 1500);
    } catch (e) {
      setError(errorText(locale, (e as ApiError).code));
    }
  }

  async function deleteAccount() {
    const answer = window.prompt(t("settings.deleteAccountConfirm"));
    if (answer !== "DELETE") return;
    try {
      await api("account", { method: "DELETE", body: { confirm: "DELETE" } });
      router.replace("/login");
      router.refresh();
    } catch (e) {
      setError(errorText(locale, (e as ApiError).code));
    }
  }

  const mockOnly = models && !models.providers.some((p) => p.id !== "mock" && p.configured);

  return (
    <>
      <header className="topbar">
        <MenuButton />
        <div className="topbar-title"><div className="t" style={{ fontSize: 24 }}>{t("settings.title")}</div></div>
      </header>
      <div className="page">
        <div className="page-inner">
          {error && <div className="alert" role="alert" style={{ marginBottom: 16 }}>{error}</div>}

          <section className="section">
            <h2 className="section-title">{t("settings.profile")}</h2>
            <form className="card" style={{ padding: 20 }} onSubmit={(e) => { e.preventDefault(); void save({ displayName: name.trim() || null }, "name"); }}>
              <div className="field">
                <label htmlFor="s-name">{t("settings.displayName")}</label>
                <input id="s-name" className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="spread">
                <span className="small muted">{user.email}</span>
                <button className="btn" type="submit">{saved === "name" ? t("settings.saved") : t("common.save")}</button>
              </div>
            </form>
          </section>

          <section className="section">
            <h2 className="section-title">{t("settings.appearance")}</h2>
            <div className="card list-card">
              <div className="row spread">
                <span>{t("settings.theme")}</span>
                <Segmented<ThemePref>
                  label={t("settings.theme")}
                  value={profile.theme}
                  onChange={(v) => save({ theme: v }, "theme")}
                  options={[
                    { value: "system", label: t("settings.theme.system") },
                    { value: "light", label: t("settings.theme.light") },
                    { value: "dark", label: t("settings.theme.dark") },
                  ]}
                />
              </div>
              <div className="row spread">
                <span>{t("settings.language")}</span>
                <Segmented<Locale> label={t("settings.language")} value={profile.locale} onChange={(v) => save({ locale: v }, "locale")} options={[{ value: "ru", label: "Русский" }, { value: "en", label: "English" }]} />
              </div>
            </div>
          </section>

          <section className="section">
            <h2 className="section-title">{t("settings.ai")}</h2>
            <div className="card" style={{ padding: 20 }}>
              <div className="spread" style={{ marginBottom: 12 }}>
                <span>{t("settings.defaultMode")}</span>
                <Segmented<Mode> label={t("settings.defaultMode")} value={profile.defaultMode} onChange={(v) => save({ defaultMode: v }, "mode")} options={(["air", "core", "prime"] as Mode[]).map((m) => ({ value: m, label: m[0]!.toUpperCase() + m.slice(1) }))} />
              </div>
              <p className="small muted">{t("settings.modesNote")}</p>
              {mockOnly && <div className="notice small" style={{ marginBottom: 12 }}>{t("settings.mockWarning")}</div>}
              {models && (
                <div className="small" style={{ display: "grid", gap: 6 }} data-testid="model-routes">
                  {models.modes.map((m) => (
                    <div key={m.mode}>
                      <b>{m.mode[0]!.toUpperCase() + m.mode.slice(1)}:</b>{" "}
                      <span className="muted">{m.route.length ? m.route.map((r) => modelLabel(r.provider, r.model)).join(" → ") : "—"}</span>
                    </div>
                  ))}
                  <div className="muted" style={{ marginTop: 6 }}>
                    {t("settings.providers")}: {models.providers.map((p) => `${p.label} (${p.configured ? t("settings.configured") : t("settings.notConfigured")})`).join(", ")}
                  </div>
                </div>
              )}
            </div>
          </section>

          <section className="section">
            <h2 className="section-title">{t("settings.personalization")}</h2>
            <form className="card" style={{ padding: 20 }} onSubmit={(e) => { e.preventDefault(); void save({ customInstructions: instructions.trim() || null }, "instr"); }}>
              <div className="field">
                <label htmlFor="s-instr">{t("settings.customInstructions")}</label>
                <textarea id="s-instr" className="textarea" maxLength={2000} value={instructions} placeholder={t("settings.customInstructionsHint")} onChange={(e) => setInstructions(e.target.value)} />
              </div>
              <button className="btn" type="submit">{saved === "instr" ? t("settings.saved") : t("common.save")}</button>
            </form>
          </section>

          {usage && (
            <section className="section">
              <h2 className="section-title">{t("settings.usage")}</h2>
              <div className="card spread" style={{ padding: 20 }} data-testid="usage">
                <div><div className="small muted">{t("settings.requests")}</div><div className="serif" style={{ fontSize: 24 }}>{usage.today.requests} / {usage.limits.perDay}</div></div>
                <div><div className="small muted">{t("settings.tokens")}</div><div className="serif" style={{ fontSize: 24 }}>{(usage.today.inputTokens + usage.today.outputTokens).toLocaleString(locale)}</div></div>
              </div>
            </section>
          )}

          <section className="section">
            <h2 className="section-title">{t("settings.privacy")}</h2>
            <div className="card" style={{ padding: 20 }}>
              <p className="small" style={{ marginTop: 0 }}>{t("settings.trainingNote")}</p>
              <p className="small muted">{t("settings.providerNote")}</p>
              <p className="small muted">{t("settings.backend")}: {backend === "local" ? t("settings.backend.local") : t("settings.backend.supabase")}</p>
              <div className="inline">
                <a className="btn" href="/api/account/export" download><Download size={16} /> {t("settings.export")}</a>
                <button className="btn btn-danger" onClick={deleteAccount}>{t("settings.deleteAccount")}</button>
              </div>
            </div>
          </section>

          <section className="section">
            <h2 className="section-title">{t("settings.future")}</h2>
            <div className="card list-card" aria-disabled="true">
              {[
                [Bell, "settings.notifications"],
                [Mic, "settings.voice"],
                [Plug, "settings.connectors"],
                [CreditCard, "settings.subscription"],
              ].map(([Icon, key]) => {
                const I = Icon as typeof Bell;
                return (
                  <div className="row" key={key as string} style={{ opacity: 0.65 }}>
                    <I size={20} strokeWidth={1.5} aria-hidden />
                    <div className="row-main"><div className="row-title">{t(key as Parameters<typeof t>[0])}</div></div>
                    <span className="badge-soon">{t("soon")}</span>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
