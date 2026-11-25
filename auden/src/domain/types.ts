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

/** Uploaded document. Only extracted text is stored (no original file). */
export interface Attachment {
  id: string;
  userId: string;
  conversationId: string | null;
  /** The user message it was sent with; null while it is only uploaded. */
  messageId: string | null;
  name: string;
  mime: "text/plain" | "text/markdown" | "application/pdf";
  size: number;
  chars: number;
  truncated: boolean;
  createdAt: string;
}

export interface AttachmentWithContent extends Attachment {
  content: string;
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
  /** Mode the request was made in (Air/Core/Prime). */
  mode: Mode | null;
  /** Milliseconds from request start to the first streamed token (null if none arrived). */
  ttftMs: number | null;
  /** Milliseconds from request start to the end of the answer or failure. */
  latencyMs: number | null;
  errorCode: string | null;
  createdAt: string;
}

/** User rating of an assistant answer: 1 = helpful, -1 = not helpful. */
export interface MessageFeedback {
  messageId: string;
  userId: string;
  rating: 1 | -1;
  createdAt: string;
}

export interface UserExport {
  exportedAt: string;
  profile: Profile;
  projects: Project[];
  conversations: (Conversation & { messages: Message[] })[];
  memories: Memory[];
  attachments: AttachmentWithContent[];
  feedback: MessageFeedback[];
  usage: UsageEvent[];
}
