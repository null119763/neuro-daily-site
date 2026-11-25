"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { BarChart3, Brain, Home, Layers, LogOut, Menu, MessageCircle, Plus, Settings, X } from "lucide-react";
import { useApp } from "../app-context";
import { api } from "../api-client";
import { ConversationList } from "./ConversationList";
import { LogoMark } from "./Logo";

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const { t, isAdmin } = useApp();
  const path = usePathname();
  const items = [
    { href: "/", label: t("nav.home"), icon: Home },
    { href: "/projects", label: t("nav.projects"), icon: Layers },
    { href: "/memory", label: t("nav.memory"), icon: Brain },
    { href: "/settings", label: t("nav.settings"), icon: Settings },
    ...(isAdmin ? [{ href: "/admin", label: t("nav.metrics"), icon: BarChart3 }] : []),
  ];
  return (
    <nav aria-label="Main" className="stack" style={{ gap: 2 }}>
      {items.map(({ href, label, icon: Icon }) => {
        const active = href === "/" ? path === "/" : path.startsWith(href);
        return (
          <Link key={href} href={href} className="nav-link" aria-current={active ? "page" : undefined} onClick={onNavigate}>
            <Icon size={19} strokeWidth={1.6} aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

function Rail({ onNavigate }: { onNavigate?: () => void }) {
  const { t, user, profile } = useApp();
  const router = useRouter();
  async function signOut() {
    await api("auth/signout", { method: "POST", body: {} }).catch(() => undefined);
    router.replace("/login");
    router.refresh();
  }
  return (
    <aside className="rail">
      <Link href="/" className="brand" onClick={onNavigate} aria-label="Auden">
        <LogoMark size={26} />
        <span className="brand-name">Auden</span>
      </Link>
      <Link href="/" className="btn btn-primary" style={{ marginBottom: 12 }} onClick={onNavigate} data-testid="new-chat">
        <Plus size={18} aria-hidden /> {t("nav.newChat")}
      </Link>
      <NavLinks onNavigate={onNavigate} />
      <div className="rail-footer">
        <div className="card" style={{ padding: "10px 12px", boxShadow: "none" }}>
          <div style={{ fontSize: 14, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis" }}>{profile.displayName || user.email}</div>
          <div className="small muted" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{user.email}</div>
        </div>
        <button className="nav-link btn-ghost" style={{ border: 0, cursor: "pointer" }} onClick={signOut}>
          <LogOut size={18} strokeWidth={1.6} aria-hidden /> {t("auth.signOut")}
        </button>
      </div>
    </aside>
  );
}

function BottomNav() {
  const { t } = useApp();
  const path = usePathname();
  const items = [
    { href: "/", label: t("nav.home"), icon: Home },
    { href: "/chats", label: t("nav.chats"), icon: MessageCircle },
    { href: "/projects", label: t("nav.projects"), icon: Layers },
    { href: "/settings", label: t("nav.settings"), icon: Settings },
  ];
  return (
    <nav className="bottom-nav" aria-label="Bottom">
      {items.map(({ href, label, icon: Icon }) => {
        const active = href === "/" ? path === "/" : path.startsWith(href);
        return (
          <Link key={href} href={href} aria-current={active ? "page" : undefined}>
            <Icon size={21} strokeWidth={1.6} aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Mobile header button that opens the navigation drawer. */
export function MenuButton() {
  const { t } = useApp();
  return (
    <button className="icon-btn mobile-only" aria-label={t("nav.menu")} onClick={() => window.dispatchEvent(new Event("auden:open-drawer"))}>
      <Menu size={22} strokeWidth={1.6} />
    </button>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { t } = useApp();
  const [drawer, setDrawer] = useState(false);
  const path = usePathname();
  const inChat = path.startsWith("/c/");
  const showList = path === "/" || inChat || path === "/chats";
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const open = () => setDrawer(true);
    window.addEventListener("auden:open-drawer", open);
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("auden:open-drawer", open);
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrawer(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawer]);

  return (
    <div className={`shell${showList && path !== "/chats" ? "" : " no-list"}`}>
      <Rail />
      {showList && path !== "/chats" && (
        <div className="list-panel">
          <ConversationList />
        </div>
      )}
      <div className="main">
        {offline && <div className="notice" role="status" style={{ borderRadius: 0, textAlign: "center" }}>{t("offline")}</div>}
        {children}
        {!inChat && <BottomNav />}
      </div>
      {drawer && (
        <>
          <div className="scrim" onClick={() => setDrawer(false)} />
          <div className="drawer" role="dialog" aria-modal="true" aria-label={t("nav.menu")}>
            <div style={{ position: "absolute", right: 8, top: 12, zIndex: 1 }}>
              <button className="icon-btn" aria-label={t("nav.close")} onClick={() => setDrawer(false)} autoFocus>
                <X size={20} />
              </button>
            </div>
            <Rail onNavigate={() => setDrawer(false)} />
            <div className="list-panel">
              <ConversationList onNavigate={() => setDrawer(false)} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
