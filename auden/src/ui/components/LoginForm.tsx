"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Brain, Layers, MessageCircle } from "lucide-react";
import type { Locale } from "@/domain/types";
import { api, ApiError } from "../api-client";
import { translate, type DictKey } from "../i18n";
import { Hills, LogoMark } from "./Logo";

export function LoginForm({ locale: initialLocale, backend, signupMode }: { locale: Locale; backend: "local" | "supabase"; signupMode: "open" | "allowlist" | "closed" }) {
  const router = useRouter();
  const [locale, setLocale] = useState<Locale>(initialLocale);
  const t = (k: DictKey) => translate(locale, k);
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [accept, setAccept] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function switchLocale(l: Locale) {
    setLocale(l);
    document.documentElement.lang = l;
    document.cookie = `auden_locale=${l}; path=/; max-age=31536000; samesite=lax`;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      if (mode === "signup") {
        const r = await api<{ needsEmailConfirmation: boolean }>("auth/signup", {
          method: "POST",
          body: { email, password, displayName: name || null, acceptTerms: accept },
        });
        if (r.needsEmailConfirmation) {
          setInfo(t("auth.confirmEmail"));
          setMode("signin");
          return;
        }
        if (locale === "en") await api("profile", { method: "PATCH", body: { locale: "en" } }).catch(() => undefined);
      } else {
        await api("auth/signin", { method: "POST", body: { email, password } });
      }
      router.replace("/");
      router.refresh();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : "generic";
      if (err instanceof ApiError && err.code === "too_many_attempts") {
        setError(`${t("auth.err.too_many_attempts")} ${Math.ceil((err.retryAfterSec ?? 60) / 60)} ${t("auth.minutes")}`);
        return;
      }
      const key = `auth.err.${code}` as DictKey;
      setError(translate(locale, key) !== key ? translate(locale, key) : t("auth.err.generic"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <aside className="auth-aside">
        <div>
          <div className="brand" style={{ marginBottom: 40 }}>
            <LogoMark size={40} />
            <span className="brand-name" style={{ fontSize: 40 }}>Auden</span>
          </div>
          <h1>{t("app.tagline")}</h1>
          <div style={{ marginTop: 32 }}>
            {[
              [MessageCircle, "feature.chat", "feature.chatSub"],
              [Layers, "feature.projects", "feature.projectsSub"],
              [Brain, "feature.memory", "feature.memorySub"],
            ].map(([Icon, a, b]) => {
              const I = Icon as typeof MessageCircle;
              return (
                <div className="feature" key={a as string}>
                  <I size={22} strokeWidth={1.6} aria-hidden />
                  <div>
                    <div>{t(a as DictKey)}</div>
                    <div className="small muted">{t(b as DictKey)}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <Hills />
      </aside>
      <main className="auth-main">
        <div className="auth-card card">
          <div style={{ textAlign: "center", marginBottom: 24 }}>
            <LogoMark size={36} />
            <h1 style={{ fontSize: 28, marginTop: 8 }}>{t("auth.title")}</h1>
            <p className="muted" style={{ margin: 0 }}>{t("auth.subtitle")}</p>
          </div>
          <div className="segmented" style={{ width: "100%", marginBottom: 20 }} role="group">
            <button type="button" style={{ flex: 1 }} aria-pressed={mode === "signin"} onClick={() => setMode("signin")}>{t("auth.signIn")}</button>
            <button type="button" style={{ flex: 1 }} aria-pressed={mode === "signup"} onClick={() => setMode("signup")} disabled={signupMode === "closed"}>{t("auth.signUp")}</button>
          </div>
          <form onSubmit={submit} noValidate>
            {mode === "signup" && (
              <div className="field">
                <label htmlFor="name">{t("auth.name")}</label>
                <input id="name" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoComplete="name" />
              </div>
            )}
            <div className="field">
              <label htmlFor="email">{t("auth.email")}</label>
              <input id="email" className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
            </div>
            <div className="field">
              <label htmlFor="password">{t("auth.password")}</label>
              <input
                id="password"
                className="input"
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                aria-describedby="pw-hint"
              />
              <span id="pw-hint" className="small muted">{t("auth.passwordHint")}</span>
            </div>
            {mode === "signup" && (
              <label className="check">
                <input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} />
                <span>{t("auth.accept")}</span>
              </label>
            )}
            {error && <div className="alert" role="alert" style={{ marginBottom: 16 }}>{error}</div>}
            {info && <div className="notice" role="status" style={{ marginBottom: 16 }}>{info}</div>}
            <button className="btn btn-primary btn-block" type="submit" disabled={busy || (mode === "signup" && !accept)} data-testid="auth-submit">
              {mode === "signup" ? t("auth.signUp") : t("auth.signIn")}
            </button>
          </form>
          {mode === "signup" && signupMode === "allowlist" && <p className="small muted" style={{ marginTop: 16, textAlign: "center" }}>{t("auth.allowlistNote")}</p>}
          {backend === "local" && <p className="small muted" style={{ marginTop: 16, textAlign: "center" }}>{t("auth.localMode")}</p>}
          <div className="inline" style={{ justifyContent: "center", marginTop: 12 }}>
            <button className="tab" aria-pressed={locale === "ru"} onClick={() => switchLocale("ru")}>Русский</button>
            <button className="tab" aria-pressed={locale === "en"} onClick={() => switchLocale("en")}>English</button>
          </div>
        </div>
      </main>
    </div>
  );
}
