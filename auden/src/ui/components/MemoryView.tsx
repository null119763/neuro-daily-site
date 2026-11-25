"use client";
import { useCallback, useEffect, useState } from "react";
import { Check, Pencil, Trash2, X } from "lucide-react";
import type { Memory } from "@/domain/types";
import { useApp } from "../app-context";
import { api, ApiError } from "../api-client";
import { errorText } from "../i18n";
import { shortTime } from "../format";
import { MenuButton } from "./AppShell";

export function MemoryView() {
  const app = useApp();
  const { t, locale, profile } = app;
  const [items, setItems] = useState<Memory[] | null>(null);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<Memory[]>("memory").then(setItems).catch((e) => setError(errorText(locale, (e as ApiError).code)));
  }, [locale]);
  useEffect(load, [load]);

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      load();
    } catch (e) {
      setError(errorText(locale, (e as ApiError).code));
    }
  }

  const projectTitle = (id: string | null) => (id ? app.projects.find((p) => p.id === id)?.title : null);
  const pending = items?.filter((m) => !m.consent) ?? [];
  const confirmed = items?.filter((m) => m.consent) ?? [];

  const renderItem = (m: Memory) => (
    <div key={m.id} className="row" data-testid="memory-item">
      <div className="row-main">
        {editing?.id === m.id ? (
          <form
            className="inline"
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => api(`memory/${m.id}`, { method: "PATCH", body: { content: editing.text } })).then(() => setEditing(null));
            }}
          >
            <input className="input" style={{ flex: 1 }} value={editing.text} maxLength={500} onChange={(e) => setEditing({ id: m.id, text: e.target.value })} autoFocus aria-label={t("memory.edit")} />
            <button className="icon-btn" type="submit" aria-label={t("common.save")}><Check size={18} /></button>
            <button className="icon-btn" type="button" onClick={() => setEditing(null)} aria-label={t("common.cancel")}><X size={18} /></button>
          </form>
        ) : (
          <>
            <div className="row-title">{m.content}</div>
            <div className="row-sub">
              {m.source === "chat" ? t("memory.fromChat") : t("memory.manual")} · {shortTime(m.createdAt, locale)}
              {projectTitle(m.projectId) ? ` · ${t("memory.project")}: ${projectTitle(m.projectId)}` : ""}
            </div>
          </>
        )}
      </div>
      {editing?.id !== m.id && (
        <div className="inline" style={{ gap: 2 }}>
          {!m.consent && (
            <button className="btn btn-primary" style={{ minHeight: 34 }} onClick={() => run(() => api(`memory/${m.id}`, { method: "PATCH", body: { consent: true } }))}>{t("memory.confirm")}</button>
          )}
          <button className="icon-btn" aria-label={t("memory.edit")} title={t("memory.edit")} onClick={() => setEditing({ id: m.id, text: m.content })}><Pencil size={17} /></button>
          <button className="icon-btn" aria-label={m.consent ? t("memory.delete") : t("memory.reject")} title={m.consent ? t("memory.delete") : t("memory.reject")} onClick={() => run(() => api(`memory/${m.id}`, { method: "DELETE" }))}><Trash2 size={17} /></button>
        </div>
      )}
    </div>
  );

  return (
    <>
      <header className="topbar">
        <MenuButton />
        <div className="topbar-title"><div className="t">{t("memory.title")}</div></div>
      </header>
      <div className="page">
        <div className="page-inner">
          <p className="muted">{t("memory.subtitle")}</p>
          <div className="card spread" style={{ padding: "14px 18px", marginBottom: 20 }}>
            <label htmlFor="mem-enabled">{t("memory.enabled")}</label>
            <span className="switch">
              <input id="mem-enabled" type="checkbox" role="switch" checked={profile.memoryEnabled} onChange={(e) => app.updateProfile({ memoryEnabled: e.target.checked }).catch(() => undefined)} />
              <span />
            </span>
          </div>
          <form
            className="inline"
            style={{ marginBottom: 24 }}
            onSubmit={(e) => {
              e.preventDefault();
              if (!draft.trim()) return;
              void run(() => api("memory", { method: "POST", body: { content: draft.trim() } })).then(() => setDraft(""));
            }}
          >
            <input className="input" style={{ flex: 1, minWidth: 200 }} placeholder={t("memory.addPlaceholder")} value={draft} maxLength={500} onChange={(e) => setDraft(e.target.value)} aria-label={t("memory.add")} data-testid="memory-input" />
            <button className="btn btn-primary" type="submit" disabled={!draft.trim()}>{t("memory.add")}</button>
          </form>
          {error && <div className="alert" role="alert" style={{ marginBottom: 16 }}>{error}</div>}
          {items === null && !error && <p className="empty">{t("common.loading")}</p>}
          {items?.length === 0 && <p className="empty">{t("memory.empty")}</p>}
          {pending.length > 0 && (
            <section className="section">
              <h2 className="section-title">{t("memory.pending")}</h2>
              <div className="card list-card">{pending.map(renderItem)}</div>
            </section>
          )}
          {confirmed.length > 0 && (
            <section className="section">
              <h2 className="section-title">{t("memory.confirmed")} · {confirmed.length}</h2>
              <div className="card list-card">{confirmed.map(renderItem)}</div>
            </section>
          )}
          {items && items.length > 0 && (
            <button className="btn btn-danger" onClick={() => window.confirm(t("memory.deleteAllConfirm")) && run(() => api("memory", { method: "DELETE" }))}>
              {t("memory.deleteAll")}
            </button>
          )}
        </div>
      </div>
    </>
  );
}
