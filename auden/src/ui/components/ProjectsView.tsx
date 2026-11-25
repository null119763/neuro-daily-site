"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronRight, Layers, Plus } from "lucide-react";
import type { Conversation, Project } from "@/domain/types";
import { useApp } from "../app-context";
import { api, ApiError } from "../api-client";
import { errorText } from "../i18n";
import { shortTime } from "../format";
import { MenuButton } from "./AppShell";

function ProjectForm({ initial, onSubmit, onCancel, submitLabel }: { initial?: Partial<Project>; onSubmit: (v: { title: string; description: string | null; instructions: string | null }) => Promise<void>; onCancel?: () => void; submitLabel: string }) {
  const { t } = useApp();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [instructions, setInstructions] = useState(initial?.instructions ?? "");
  const [busy, setBusy] = useState(false);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await onSubmit({ title: title.trim(), description: description.trim() || null, instructions: instructions.trim() || null });
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="field">
        <label htmlFor="p-title">{t("projects.name")}</label>
        <input id="p-title" className="input" required maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
      </div>
      <div className="field">
        <label htmlFor="p-desc">{t("projects.description")}</label>
        <input id="p-desc" className="input" maxLength={1000} value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="p-instr">{t("projects.instructions")}</label>
        <textarea id="p-instr" className="textarea" maxLength={4000} value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder={t("projects.instructionsHint")} />
      </div>
      <div className="inline">
        <button className="btn btn-primary" type="submit" disabled={busy || !title.trim()}>{submitLabel}</button>
        {onCancel && <button className="btn" type="button" onClick={onCancel}>{t("projects.cancel")}</button>}
      </div>
    </form>
  );
}

export function ProjectsView() {
  const app = useApp();
  const { t, locale } = app;
  const router = useRouter();
  const params = useSearchParams();
  const [creating, setCreating] = useState(params.get("new") === "1");
  const [archived, setArchived] = useState(false);
  const [list, setList] = useState<Project[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Project[]>(`projects${archived ? "?archived=1" : ""}`)
      .then((l) => setList(archived ? l.filter((p) => p.archived) : l))
      .catch((e) => setError(errorText(locale, (e as ApiError).code)));
  }, [archived, locale, app.projects]);

  return (
    <>
      <header className="topbar">
        <MenuButton />
        <div className="topbar-title"><div className="t">{t("projects.title")}</div></div>
        <button className="btn btn-primary" onClick={() => setCreating(true)} data-testid="new-project"><Plus size={18} /> {t("projects.new")}</button>
      </header>
      <div className="page">
        <div className="page-inner">
          <div className="tabs" role="tablist" style={{ marginBottom: 16 }}>
            <button className="tab" role="tab" aria-selected={!archived} onClick={() => setArchived(false)}>{t("projects.mine")}</button>
            <button className="tab" role="tab" aria-selected={archived} onClick={() => setArchived(true)}>{t("projects.showArchived")}</button>
          </div>
          {creating && (
            <div className="card" style={{ padding: 20, marginBottom: 20 }}>
              <h2>{t("projects.new")}</h2>
              <ProjectForm
                submitLabel={t("projects.create")}
                onCancel={() => setCreating(false)}
                onSubmit={async (v) => {
                  try {
                    const p = await api<Project>("projects", { method: "POST", body: v });
                    await app.refreshProjects();
                    router.push(`/projects/${p.id}`);
                  } catch (e) {
                    setError(errorText(locale, (e as ApiError).code));
                  }
                }}
              />
            </div>
          )}
          {error && <div className="alert" role="alert">{error}</div>}
          {list === null && !error && <p className="empty">{t("common.loading")}</p>}
          {list?.length === 0 && !creating && <p className="empty">{t("projects.empty")}</p>}
          {list && list.length > 0 && (
            <div className="card list-card">
              {list.map((p) => (
                <Link key={p.id} href={`/projects/${p.id}`} className="row" data-testid="project-row">
                  <Layers size={22} strokeWidth={1.5} aria-hidden />
                  <div className="row-main">
                    <div className="row-title">{p.title}</div>
                    <div className="row-sub">{p.description || `${t("projects.updated")} ${shortTime(p.updatedAt, locale)}`}</div>
                  </div>
                  <ChevronRight size={18} className="muted" aria-hidden />
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export function ProjectDetailView({ id }: { id: string }) {
  const app = useApp();
  const { t, locale } = app;
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [chats, setChats] = useState<Conversation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    Promise.all([api<Project>(`projects/${id}`), api<Conversation[]>(`conversations?projectId=${id}`)])
      .then(([p, c]) => {
        setProject(p);
        setChats(c);
      })
      .catch((e) => setError(errorText(locale, (e as ApiError).code)));
  }, [id, locale]);

  async function patch(body: Partial<Project>) {
    try {
      setProject(await api<Project>(`projects/${id}`, { method: "PATCH", body }));
      await app.refreshProjects();
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (e) {
      setError(errorText(locale, (e as ApiError).code));
    }
  }

  async function remove() {
    if (!window.confirm(t("projects.deleteConfirm"))) return;
    await api(`projects/${id}`, { method: "DELETE" });
    await Promise.all([app.refreshProjects(), app.refreshConversations()]);
    router.replace("/projects");
  }

  return (
    <>
      <header className="topbar">
        <MenuButton />
        <div className="topbar-title">
          <div className="t">{project?.title ?? t("projects.title")}</div>
          <div className="s"><Link href="/projects">{t("projects.title")}</Link></div>
        </div>
        {project && <Link href={`/?project=${project.id}`} className="btn btn-primary" data-testid="project-new-chat"><Plus size={18} /> {t("projects.newChat")}</Link>}
      </header>
      <div className="page">
        <div className="page-inner">
          {error && <div className="alert" role="alert">{error}</div>}
          {project && (
            <>
              <section className="section">
                <h2 className="section-title">{t("projects.chats")}</h2>
                {chats.length === 0 ? (
                  <p className="muted small">{t("list.empty")}</p>
                ) : (
                  <div className="card list-card">
                    {chats.map((c) => (
                      <Link key={c.id} href={`/c/${c.id}`} className="row">
                        <div className="row-main">
                          <div className="row-title">{c.title}</div>
                          <div className="row-sub">{shortTime(c.updatedAt, locale)}</div>
                        </div>
                        <ChevronRight size={18} className="muted" aria-hidden />
                      </Link>
                    ))}
                  </div>
                )}
              </section>
              <section className="section card" style={{ padding: 20 }}>
                <ProjectForm key={project.updatedAt} initial={project} submitLabel={saved ? t("settings.saved") : t("projects.save")} onSubmit={(v) => patch(v)} />
              </section>
              <div className="inline">
                <button className="btn" onClick={() => patch({ archived: !project.archived })}>{project.archived ? t("projects.unarchive") : t("projects.archive")}</button>
                <button className="btn btn-danger" onClick={remove}>{t("projects.delete")}</button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
