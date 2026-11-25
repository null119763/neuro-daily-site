"use client";
import { useApp } from "@/ui/app-context";
import { MenuButton } from "@/ui/components/AppShell";
import { ConversationList } from "@/ui/components/ConversationList";

export default function ChatsPage() {
  const { t } = useApp();
  return (
    <>
      <header className="topbar">
        <MenuButton />
        <div className="topbar-title"><div className="t">{t("nav.chats")}</div></div>
      </header>
      <div className="list-panel" style={{ flex: 1, minHeight: 0, borderRight: 0 }}>
        <ConversationList />
      </div>
    </>
  );
}
