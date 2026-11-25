"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Search, Star } from "lucide-react";
import type { Conversation } from "@/domain/types";
import { useApp } from "../app-context";
import { api } from "../api-client";
import { dayGroup, shortTime } from "../format";

type Tab = "all" | "projects" | "favorites";

export function ConversationList({ onNavigate }: { onNavigate?: () => void }) {
  const { t, locale, conversations, projects } = useApp();
  const path = usePathname();
  const [tab, setTab] = useState<Tab>("all");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Conversation[] | null>(null);

  // Server-side search over titles and message content (debounced).
  useEffect(() => {
    const q = query.trim();
    if (!q) return;
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      api<Conversation[]>(`conversations?q=${encodeURIComponent(q)}`, { signal: ctrl.signal })
        .then(setResults)
        .catch(() => undefined);
    }, 250);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [query]);

  const projectTitle = useMemo(() => new Map(projects.map((p) => [p.id, p.title])), [projects]);
  const searching = query.trim().length > 0;
  const list = (searching ? (results ?? []) : conversations).filter((c) => (tab === "favorites" ? c.favorite : tab === "projects" ? c.projectId !== null : true));

  const groups: { key: "today" | "yesterday" | "earlier"; label: string; items: Conversation[] }[] = [
    { key: "today", label: t("list.today"), items: [] },
    { key: "yesterday", label: t("list.yesterday"), items: [] },
    { key: "earlier", label: t("list.earlier"), items: [] },
  ];
  for (const c of list) groups.find((g) => g.key === dayGroup(c.updatedAt))!.items.push(c);

  return (
    <>
      <div className="list-head">
        <div className="search">
          <Search size={16} aria-hidden />
          <input
            className="input"
            type="search"
            placeholder={t("list.search")}
            aria-label={t("list.search")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            maxLength={100}
          />
        </div>
      </div>
      <div className="list-tabs tabs" role="tablist">
        {(["all", "projects", "favorites"] as Tab[]).map((k) => (
          <button key={k} role="tab" className="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
            {t(k === "all" ? "list.all" : k === "projects" ? "list.projects" : "list.favorites")}
          </button>
        ))}
      </div>
      <div className="conv-list" data-testid="conversation-list">
        {list.length === 0 && <p className="empty small">{query ? t("list.noResults") : t("list.empty")}</p>}
        {groups
          .filter((g) => g.items.length)
          .map((g) => (
            <section key={g.key} aria-label={g.label}>
              <div className="group-label">{g.label}</div>
              {g.items.map((c) => (
                <Link
                  key={c.id}
                  href={`/c/${c.id}`}
                  className="conv-item"
                  aria-current={path === `/c/${c.id}` ? "page" : undefined}
                  onClick={onNavigate}
                >
                  <span className="conv-title">
                    {c.favorite && <Star size={12} style={{ marginRight: 4, verticalAlign: -1 }} aria-label={t("list.favorites")} />}
                    {c.title}
                  </span>
                  <span className="conv-time">{shortTime(c.updatedAt, locale)}</span>
                  <span className="conv-sub">{c.projectId ? projectTitle.get(c.projectId) ?? "" : c.mode[0]!.toUpperCase() + c.mode.slice(1)}</span>
                </Link>
              ))}
            </section>
          ))}
      </div>
    </>
  );
}
