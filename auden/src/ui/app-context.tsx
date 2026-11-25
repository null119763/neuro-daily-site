"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { AuthUser, Conversation, Locale, Profile, Project, ThemePref } from "@/domain/types";
import { api } from "./api-client";
import { translate, type DictKey } from "./i18n";

export interface AppState {
  user: AuthUser;
  profile: Profile;
  backend: "local" | "supabase";
  locale: Locale;
  t: (key: DictKey) => string;
  updateProfile: (patch: Partial<Profile>) => Promise<void>;
  conversations: Conversation[];
  projects: Project[];
  refreshConversations: () => Promise<void>;
  refreshProjects: () => Promise<void>;
  upsertConversation: (c: Conversation) => void;
  removeConversation: (id: string) => void;
}

const Ctx = createContext<AppState | null>(null);

export function applyTheme(theme: ThemePref) {
  document.documentElement.dataset.theme = theme;
  document.cookie = `auden_theme=${theme}; path=/; max-age=31536000; samesite=lax`;
}

function applyLocale(locale: Locale) {
  document.documentElement.lang = locale;
  document.cookie = `auden_locale=${locale}; path=/; max-age=31536000; samesite=lax`;
}

export function AppProvider(props: { user: AuthUser; profile: Profile; backend: "local" | "supabase"; children: ReactNode }) {
  const [profile, setProfile] = useState(props.profile);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const locale = profile.locale;

  useEffect(() => {
    applyTheme(profile.theme);
  }, [profile.theme]);
  useEffect(() => {
    applyLocale(locale);
  }, [locale]);

  const refreshConversations = useCallback(async () => {
    setConversations(await api<Conversation[]>("conversations"));
  }, []);
  const refreshProjects = useCallback(async () => {
    setProjects(await api<Project[]>("projects"));
  }, []);

  useEffect(() => {
    api<Conversation[]>("conversations").then(setConversations).catch(() => undefined);
    api<Project[]>("projects").then(setProjects).catch(() => undefined);
  }, []);

  const updateProfile = useCallback(async (patch: Partial<Profile>) => {
    const prev = profile;
    setProfile({ ...profile, ...patch });
    try {
      setProfile(await api<Profile>("profile", { method: "PATCH", body: patch }));
    } catch (e) {
      setProfile(prev);
      throw e;
    }
  }, [profile]);

  const value = useMemo<AppState>(
    () => ({
      user: props.user,
      profile,
      backend: props.backend,
      locale,
      t: (k) => translate(locale, k),
      updateProfile,
      conversations,
      projects,
      refreshConversations,
      refreshProjects,
      upsertConversation: (c) => setConversations((list) => [c, ...list.filter((x) => x.id !== c.id)]),
      removeConversation: (id) => setConversations((list) => list.filter((x) => x.id !== id)),
    }),
    [props.user, props.backend, profile, locale, updateProfile, conversations, projects, refreshConversations, refreshProjects],
  );

  return <Ctx.Provider value={value}>{props.children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp outside AppProvider");
  return v;
}
