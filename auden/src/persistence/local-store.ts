import { randomUUID } from "node:crypto";
import type { Conversation, Memory, Message, Profile, Project, UsageEvent } from "@/domain/types";
import type { LocalData, LocalDatabase } from "./local-db";
import type {
  ConversationFilter,
  ConversationInput,
  ConversationPatch,
  GlobalUsage,
  MemoryInput,
  MemoryPatch,
  MessageInput,
  ProfilePatch,
  ProjectInput,
  ProjectPatch,
  UsageInput,
  UserStore,
} from "./store";

const nowIso = () => new Date().toISOString();
const clone = <T>(v: T): T => structuredClone(v);
const byUpdatedDesc = (a: { updatedAt: string }, b: { updatedAt: string }) => b.updatedAt.localeCompare(a.updatedAt);

export function defaultProfile(id: string, email: string, displayName: string | null): Profile {
  return {
    id,
    email,
    displayName,
    locale: "ru",
    theme: "system",
    defaultMode: "core",
    memoryEnabled: true,
    customInstructions: null,
    createdAt: nowIso(),
  };
}

/** UserStore over the local JSON database. Every query filters by userId (mirrors RLS). */
export class LocalUserStore implements UserStore {
  constructor(
    private readonly db: LocalDatabase,
    readonly userId: string,
  ) {}

  private async d(): Promise<LocalData> {
    return this.db.read();
  }

  async getProfile(): Promise<Profile> {
    const p = (await this.d()).profiles.find((x) => x.id === this.userId);
    if (!p) throw new Error("Profile not found");
    return clone(p);
  }

  async updateProfile(patch: ProfilePatch): Promise<Profile> {
    return this.db.mutate((d) => {
      const p = d.profiles.find((x) => x.id === this.userId);
      if (!p) throw new Error("Profile not found");
      Object.assign(p, patch);
      return clone(p);
    });
  }

  // ---- projects
  async listProjects(opts: { includeArchived?: boolean } = {}): Promise<Project[]> {
    return clone(
      (await this.d()).projects.filter((p) => p.userId === this.userId && (opts.includeArchived || !p.archived)).sort(byUpdatedDesc),
    );
  }

  async getProject(id: string): Promise<Project | null> {
    const p = (await this.d()).projects.find((x) => x.id === id && x.userId === this.userId);
    return p ? clone(p) : null;
  }

  async createProject(input: ProjectInput): Promise<Project> {
    const t = nowIso();
    const p: Project = { id: randomUUID(), userId: this.userId, archived: false, createdAt: t, updatedAt: t, ...input };
    await this.db.mutate((d) => d.projects.push(p));
    return clone(p);
  }

  async updateProject(id: string, patch: ProjectPatch): Promise<Project | null> {
    return this.db.mutate((d) => {
      const p = d.projects.find((x) => x.id === id && x.userId === this.userId);
      if (!p) return null;
      Object.assign(p, patch, { updatedAt: nowIso() });
      return clone(p);
    });
  }

  async deleteProject(id: string): Promise<boolean> {
    return this.db.mutate((d) => {
      const i = d.projects.findIndex((x) => x.id === id && x.userId === this.userId);
      if (i < 0) return false;
      d.projects.splice(i, 1);
      for (const c of d.conversations) if (c.projectId === id && c.userId === this.userId) c.projectId = null;
      for (const m of d.memories) if (m.projectId === id && m.userId === this.userId) m.projectId = null;
      return true;
    });
  }

  // ---- conversations
  async listConversations(filter: ConversationFilter = {}): Promise<Conversation[]> {
    const d = await this.d();
    const q = filter.query?.toLowerCase().trim();
    let list = d.conversations.filter((c) => c.userId === this.userId);
    if (filter.projectId) list = list.filter((c) => c.projectId === filter.projectId);
    if (filter.favorite !== undefined) list = list.filter((c) => c.favorite === filter.favorite);
    if (q) {
      const matchingConv = new Set(
        d.messages.filter((m) => m.userId === this.userId && m.content.toLowerCase().includes(q)).map((m) => m.conversationId),
      );
      list = list.filter((c) => c.title.toLowerCase().includes(q) || matchingConv.has(c.id));
    }
    return clone(list.sort(byUpdatedDesc).slice(0, filter.limit ?? 200));
  }

  async getConversation(id: string): Promise<Conversation | null> {
    const c = (await this.d()).conversations.find((x) => x.id === id && x.userId === this.userId);
    return c ? clone(c) : null;
  }

  async createConversation(input: ConversationInput): Promise<Conversation> {
    if (input.projectId && !(await this.getProject(input.projectId))) throw new Error("Project not found");
    const t = nowIso();
    const c: Conversation = { id: randomUUID(), userId: this.userId, favorite: false, createdAt: t, updatedAt: t, ...input };
    await this.db.mutate((d) => d.conversations.push(c));
    return clone(c);
  }

  async updateConversation(id: string, patch: ConversationPatch): Promise<Conversation | null> {
    if (patch.projectId && !(await this.getProject(patch.projectId))) return null;
    return this.db.mutate((d) => {
      const c = d.conversations.find((x) => x.id === id && x.userId === this.userId);
      if (!c) return null;
      Object.assign(c, patch, { updatedAt: nowIso() });
      return clone(c);
    });
  }

  async deleteConversation(id: string): Promise<boolean> {
    return this.db.mutate((d) => {
      const i = d.conversations.findIndex((x) => x.id === id && x.userId === this.userId);
      if (i < 0) return false;
      d.conversations.splice(i, 1);
      d.messages = d.messages.filter((m) => m.conversationId !== id);
      for (const m of d.memories) if (m.sourceConversationId === id) m.sourceConversationId = null;
      return true;
    });
  }

  // ---- messages
  async listMessages(conversationId: string, opts: { limit?: number } = {}): Promise<Message[]> {
    const list = (await this.d()).messages.filter((m) => m.conversationId === conversationId && m.userId === this.userId);
    return clone(opts.limit ? list.slice(-opts.limit) : list);
  }

  async addMessage(conversationId: string, input: MessageInput): Promise<Message | null> {
    return this.db.mutate((d) => {
      const c = d.conversations.find((x) => x.id === conversationId && x.userId === this.userId);
      if (!c) return null;
      const t = nowIso();
      const m: Message = {
        id: randomUUID(),
        conversationId,
        userId: this.userId,
        role: input.role,
        content: input.content,
        provider: input.provider ?? null,
        model: input.model ?? null,
        status: input.status ?? "complete",
        inputTokens: input.inputTokens ?? 0,
        outputTokens: input.outputTokens ?? 0,
        createdAt: t,
      };
      d.messages.push(m);
      c.updatedAt = t;
      return clone(m);
    });
  }

  // ---- memories
  async listMemories(opts: { consent?: boolean; projectId?: string | null } = {}): Promise<Memory[]> {
    let list = (await this.d()).memories.filter((m) => m.userId === this.userId);
    if (opts.consent !== undefined) list = list.filter((m) => m.consent === opts.consent);
    // projectId given: global memories + that project's memories. Other projects' memories are isolated.
    if (opts.projectId !== undefined) list = list.filter((m) => m.projectId === null || m.projectId === opts.projectId);
    return clone(list.sort(byUpdatedDesc));
  }

  async createMemory(input: MemoryInput): Promise<Memory> {
    if (input.projectId && !(await this.getProject(input.projectId))) throw new Error("Project not found");
    const t = nowIso();
    const m: Memory = { id: randomUUID(), userId: this.userId, createdAt: t, updatedAt: t, ...input };
    await this.db.mutate((d) => d.memories.push(m));
    return clone(m);
  }

  async updateMemory(id: string, patch: MemoryPatch): Promise<Memory | null> {
    return this.db.mutate((d) => {
      const m = d.memories.find((x) => x.id === id && x.userId === this.userId);
      if (!m) return null;
      Object.assign(m, patch, { updatedAt: nowIso() });
      return clone(m);
    });
  }

  async deleteMemory(id: string): Promise<boolean> {
    return this.db.mutate((d) => {
      const i = d.memories.findIndex((x) => x.id === id && x.userId === this.userId);
      if (i < 0) return false;
      d.memories.splice(i, 1);
      return true;
    });
  }

  async deleteAllMemories(): Promise<number> {
    return this.db.mutate((d) => {
      const before = d.memories.length;
      d.memories = d.memories.filter((m) => m.userId !== this.userId);
      return before - d.memories.length;
    });
  }

  // ---- usage
  async recordUsage(input: UsageInput): Promise<void> {
    const e: UsageEvent = { id: randomUUID(), userId: this.userId, createdAt: nowIso(), ...input };
    await this.db.mutate((d) => d.usage.push(e));
  }

  async countRequests(since: Date): Promise<number> {
    const s = since.toISOString();
    return (await this.d()).usage.filter((u) => u.userId === this.userId && u.createdAt >= s).length;
  }

  async listUsage(since: Date): Promise<UsageEvent[]> {
    const s = since.toISOString();
    return clone((await this.d()).usage.filter((u) => u.userId === this.userId && u.createdAt >= s));
  }

  // ---- account
  async exportAll() {
    const d = await this.d();
    const conversations = d.conversations
      .filter((c) => c.userId === this.userId)
      .map((c) => ({ ...c, messages: d.messages.filter((m) => m.conversationId === c.id) }));
    return clone({
      exportedAt: nowIso(),
      profile: await this.getProfile(),
      projects: d.projects.filter((p) => p.userId === this.userId),
      conversations,
      memories: d.memories.filter((m) => m.userId === this.userId),
      usage: d.usage.filter((u) => u.userId === this.userId),
    });
  }

  async deleteAccount(): Promise<void> {
    const uid = this.userId;
    await this.db.mutate((d) => {
      d.users = d.users.filter((u) => u.id !== uid);
      d.sessions = d.sessions.filter((s) => s.userId !== uid);
      d.profiles = d.profiles.filter((p) => p.id !== uid);
      d.projects = d.projects.filter((p) => p.userId !== uid);
      d.conversations = d.conversations.filter((c) => c.userId !== uid);
      d.messages = d.messages.filter((m) => m.userId !== uid);
      d.memories = d.memories.filter((m) => m.userId !== uid);
      // Usage rows are kept anonymised for global quota/accounting integrity until the day rolls over.
      for (const u of d.usage) if (u.userId === uid) u.userId = "deleted";
    });
  }
}

export class LocalGlobalUsage implements GlobalUsage {
  constructor(private readonly db: LocalDatabase) {}
  async countRequests(since: Date, perUserCap: number): Promise<number> {
    const s = since.toISOString();
    const perUser = new Map<string, number>();
    for (const u of (await this.db.read()).usage) if (u.createdAt >= s) perUser.set(u.userId, (perUser.get(u.userId) ?? 0) + 1);
    let total = 0;
    for (const n of perUser.values()) total += Math.min(n, perUserCap);
    return total;
  }
  async sumCost(since: Date): Promise<number> {
    const s = since.toISOString();
    return (await this.db.read()).usage.filter((u) => u.createdAt >= s).reduce((a, u) => a + u.cost, 0);
  }
}
