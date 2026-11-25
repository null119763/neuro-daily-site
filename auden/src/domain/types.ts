import type { Mode } from "@/core/types";

export type Locale = "ru" | "en";
export type ThemePref = "system" | "light" | "dark";
export type MessageStatus = "complete" | "error" | "cancelled";
export type MemorySource = "chat" | "manual";

export interface AuthUser {
  id: string;
  email: string;
}

export interface Profile {
  id: string;
  email: string;
  displayName: string | null;
  locale: Locale;
  theme: ThemePref;
  defaultMode: Mode;
  memoryEnabled: boolean;
  customInstructions: string | null;
  createdAt: string;
}

export interface Project {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  instructions: string | null;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Conversation {
  id: string;
  userId: string;
  projectId: string | null;
  title: string;
  favorite: boolean;
  mode: Mode;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  conversationId: string;
  userId: string;
  role: "user" | "assistant";
  content: string;
  provider: string | null;
  model: string | null;
  status: MessageStatus;
  inputTokens: number;
  outputTokens: number;
  createdAt: string;
}

export interface Memory {
  id: string;
  userId: string;
  projectId: string | null;
  content: string;
  source: MemorySource;
  sourceConversationId: string | null;
  /** false = proposal awaiting user confirmation; true = confirmed, may be used in context. */
  consent: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UsageEvent {
  id: string;
  userId: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  status: MessageStatus;
  createdAt: string;
}

export interface UserExport {
  exportedAt: string;
  profile: Profile;
  projects: Project[];
  conversations: (Conversation & { messages: Message[] })[];
  memories: Memory[];
  usage: UsageEvent[];
}
