import type { Mode } from "@/core/types";
import type {
  Attachment,
  AttachmentWithContent,
  Conversation,
  Memory,
  MemorySource,
  MessageFeedback,
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
export type AttachmentInput = Pick<AttachmentWithContent, "name" | "mime" | "size" | "content" | "truncated">;
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
  /** Deletes one owned message. Used to replace an assistant answer on regenerate. */
  deleteMessage(id: string): Promise<boolean>;

  listMemories(opts?: { consent?: boolean; projectId?: string | null }): Promise<Memory[]>;
  createMemory(input: MemoryInput): Promise<Memory>;
  updateMemory(id: string, patch: MemoryPatch): Promise<Memory | null>;
  deleteMemory(id: string): Promise<boolean>;
  deleteAllMemories(): Promise<number>;

  createAttachment(input: AttachmentInput): Promise<Attachment>;
  /** Owned attachments by id (metadata only). Missing or foreign ids are silently skipped. */
  getAttachments(ids: string[]): Promise<Attachment[]>;
  /** All attachments sent in a conversation, oldest first, with extracted text (for model context). */
  listConversationAttachments(conversationId: string): Promise<AttachmentWithContent[]>;
  /** Binds uploaded, not-yet-sent attachments to a conversation and the user message they were sent with. */
  linkAttachments(ids: string[], conversationId: string, messageId: string): Promise<number>;
  /** Deletes an attachment that has not been sent yet. Sent ones go with their conversation. */
  deleteAttachment(id: string): Promise<boolean>;
  /** Removes uploads never sent with a message and older than `before`. */
  deleteStaleUploads(before: Date): Promise<number>;
  countAttachments(since: Date): Promise<number>;

  /** Rates an owned assistant message (1 / -1) or clears the rating (null). False if not found. */
  setFeedback(messageId: string, rating: 1 | -1 | null): Promise<boolean>;
  listFeedback(conversationId: string): Promise<MessageFeedback[]>;

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
