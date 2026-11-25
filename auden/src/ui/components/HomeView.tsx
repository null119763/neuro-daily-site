"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Brain, Layers, Mic, MessageCirclePlus } from "lucide-react";
import { useApp } from "../app-context";
import { ChatView } from "./ChatView";

/** Start screen: greeting, quick actions and a composer that creates a new conversation. */
export function HomeView({ projectId }: { projectId: string | null }) {
  const { t, profile, projects } = useApp();
  const path = usePathname();
  const [resetKey, setResetKey] = useState(0);
  const prev = useRef(path);

  // A new conversation rewrites the URL to /c/:id without remounting; going back to "/" must start fresh.
  useEffect(() => {
    if (path === "/" && prev.current !== "/") setResetKey((k) => k + 1);
    prev.current = path;
  }, [path]);

  const project = projectId ? projects.find((p) => p.id === projectId) : null;
  const name = profile.displayName?.split(" ")[0];

  const intro = (
    <div className="home-hero">
      <h1>{t("home.hello")}{name ? `, ${name}` : ""}.</h1>
      <p className="muted" style={{ fontSize: 18, margin: 0 }}>{project ? `${t("nav.projects")}: ${project.title}` : t("home.question")}</p>
      <div className="quick-grid">
        <button className="card quick" onClick={() => document.getElementById("composer-input")?.focus()}>
          <MessageCirclePlus size={22} aria-hidden />
          {t("home.newChat")}
        </button>
        <Link href="/projects?new=1" className="card quick">
          <Layers size={22} aria-hidden />
          {t("home.newProject")}
        </Link>
        <Link href="/memory" className="card quick">
          <Brain size={22} aria-hidden />
          {t("home.memory")}
        </Link>
        <div className="card quick" aria-disabled="true" style={{ opacity: 0.6, cursor: "default" }} title={t("soon.voice")}>
          <Mic size={22} aria-hidden />
          <span>
            {t("home.voice")} <span className="badge-soon">{t("soon")}</span>
          </span>
        </div>
      </div>
    </div>
  );

  return <ChatView key={`${projectId ?? "none"}-${resetKey}`} conversationId={null} projectId={projectId} intro={intro} />;
}
