import type { Mode } from "@/core/types";
import type {
  Conversation,
  Memory,
  MemorySource,
  Message,
  MessageStatus,
  Profile,
  Project,
  UsageEvent,
  UserExport,
} from "@/domain/types";

export type ProfilePatch = Partial<Pick<Profile, "displayName" | "locale" | "theme" | "defaultMode" | "memoryEnabled" | "customInstructions">>;
export type ProjectInput = Pick<Project, "title" | "description" | "instructions">;
export type ProjectPatch = Partial<ProjectInput & { archived: boolean }>;
export type ConversationInput = { title: string; projectId: string | null; mode: Mode };
export type ConversationPatch = Partial<Pick<Conversation, "title" | "favorite" | "projectId" | "mode">>;
export type MessageInput = {
  role: "user" | "assistant";
  content: string;
  provider?: string | null;
  model?: string | null;
  status?: MessageStatus;
  inputTokens?: number;
  outputTokens?: number;
};
export type MemoryInput = { content: string; projectId: string | null; source: MemorySource; sourceConversationId: string | null; consent: boolean };
export type MemoryPatch = Partial<Pick<Memory, "content" | "consent">>;
export type UsageInput = Omit<UsageEvent, "id" | "userId" | "createdAt">;

export interface ConversationFilter {
  projectId?: string;
  favorite?: boolean;
  query?: string;
  limit?: number;
}

/**
 * Data access scoped to a single authenticated user.
 * Every method only sees and changes rows owned by that user — the same guarantee RLS gives in Postgres.
 * Methods return null (or false) for objects that do not exist *or* belong to someone else; callers map both to 404.
 */
export interface UserStore {
  readonly userId: string;

  getProfile(): Promise<Profile>;
  updateProfile(patch: ProfilePatch): Promise<Profile>;

  listProjects(opts?: { includeArchived?: boolean }): Promise<Project[]>;
  getProject(id: string): Promise<Project | null>;
  createProject(input: ProjectInput): Promise<Project>;
  updateProject(id: string, patch: ProjectPatch): Promise<Project | null>;
  /** Deletes the project. Its conversations are kept and detached (project_id = null). */
  deleteProject(id: string): Promise<boolean>;

  listConversations(filter?: ConversationFilter): Promise<Conversation[]>;
  getConversation(id: string): Promise<Conversation | null>;
  createConversation(input: ConversationInput): Promise<Conversation>;
  updateConversation(id: string, patch: ConversationPatch): Promise<Conversation | null>;
  /** Deletes the conversation and its messages. */
  deleteConversation(id: string): Promise<boolean>;

  listMessages(conversationId: string, opts?: { limit?: number }): Promise<Message[]>;
  /** Appends a message and bumps the conversation's updatedAt. Returns null if the conversation is not owned. */
  addMessage(conversationId: string, input: MessageInput): Promise<Message | null>;

  listMemories(opts?: { consent?: boolean; projectId?: string | null }): Promise<Memory[]>;
  createMemory(input: MemoryInput): Promise<Memory>;
  updateMemory(id: string, patch: MemoryPatch): Promise<Memory | null>;
  deleteMemory(id: string): Promise<boolean>;
  deleteAllMemories(): Promise<number>;

  recordUsage(input: UsageInput): Promise<void>;
  countRequests(since: Date): Promise<number>;
  listUsage(since: Date): Promise<UsageEvent[]>;

  exportAll(): Promise<UserExport>;
  /** Deletes all user data including the profile and auth identity where the backend allows it. */
  deleteAccount(): Promise<void>;
}

/** Aggregate usage across all users (for global ceilings). Implementations must not leak per-user data. */
export interface GlobalUsage {
  /** Requests since `since`, counting at most `perUserCap` per user (abuse resistance). */
  countRequests(since: Date, perUserCap: number): Promise<number>;
  sumCost(since: Date): Promise<number>;
}
