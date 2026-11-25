import type { SupabaseClient } from "@supabase/supabase-js";
import type { Conversation, Memory, Message, Profile, Project, UsageEvent, UserExport } from "@/domain/types";
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

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

const toProfile = (r: Row): Profile => ({
  id: r.id,
  email: r.email,
  displayName: r.display_name,
  locale: r.locale,
  theme: r.theme,
  defaultMode: r.default_mode,
  memoryEnabled: r.memory_enabled,
  customInstructions: r.custom_instructions,
  createdAt: r.created_at,
});
const toProject = (r: Row): Project => ({
  id: r.id,
  userId: r.user_id,
  title: r.title,
  description: r.description,
  instructions: r.instructions,
  archived: r.archived,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});
const toConversation = (r: Row): Conversation => ({
  id: r.id,
  userId: r.user_id,
  projectId: r.project_id,
  title: r.title,
  favorite: r.favorite,
  mode: r.mode,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});
const toMessage = (r: Row): Message => ({
  id: r.id,
  conversationId: r.conversation_id,
  userId: r.user_id,
  role: r.role,
  content: r.content,
  provider: r.provider,
  model: r.model,
  status: r.status,
  inputTokens: r.input_tokens,
  outputTokens: r.output_tokens,
  createdAt: r.created_at,
});
const toMemory = (r: Row): Memory => ({
  id: r.id,
  userId: r.user_id,
  projectId: r.project_id,
  content: r.content,
  source: r.source,
  sourceConversationId: r.source_conversation_id,
  consent: r.consent,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});
const toUsage = (r: Row): UsageEvent => ({
  id: r.id,
  userId: r.user_id,
  provider: r.provider,
  model: r.model,
  inputTokens: r.input_tokens,
  outputTokens: r.output_tokens,
  cost: Number(r.cost),
  status: r.status,
  createdAt: r.created_at,
});

function check<T>(res: { data: T; error: { message: string; code?: string } | null }): T {
  if (res.error) throw new Error(`Database error: ${res.error.message}`);
  return res.data;
}

function one(res: { data: Row | null; error: { message: string; code?: string } | null }): Row {
  const d = check(res);
  if (!d) throw new Error("Database error: no row returned");
  return d;
}

const now = () => new Date().toISOString();

/**
 * UserStore over Supabase using the *user's* JWT, so Postgres RLS is the final authority.
 * The explicit user_id filters below are defence in depth and keep query plans on owner indexes.
 * NOTE: this adapter has not yet been run against a live Supabase project (needs owner's project, see DECISIONS P2).
 */
export class SupabaseUserStore implements UserStore {
  constructor(
    private readonly sb: SupabaseClient,
    readonly userId: string,
  ) {}

  async getProfile(): Promise<Profile> {
    return toProfile(one(await this.sb.from("profiles").select("*").eq("id", this.userId).single()));
  }

  async updateProfile(p: ProfilePatch): Promise<Profile> {
    const patch: Row = {};
    if (p.displayName !== undefined) patch.display_name = p.displayName;
    if (p.locale !== undefined) patch.locale = p.locale;
    if (p.theme !== undefined) patch.theme = p.theme;
    if (p.defaultMode !== undefined) patch.default_mode = p.defaultMode;
    if (p.memoryEnabled !== undefined) patch.memory_enabled = p.memoryEnabled;
    if (p.customInstructions !== undefined) patch.custom_instructions = p.customInstructions;
    return toProfile(one(await this.sb.from("profiles").update(patch).eq("id", this.userId).select("*").single()));
  }

  async listProjects(opts: { includeArchived?: boolean } = {}): Promise<Project[]> {
    let q = this.sb.from("projects").select("*").eq("user_id", this.userId);
    if (!opts.includeArchived) q = q.eq("archived", false);
    return (check(await q.order("updated_at", { ascending: false })) as Row[]).map(toProject);
  }

  async getProject(id: string): Promise<Project | null> {
    const r = check(await this.sb.from("projects").select("*").eq("id", id).eq("user_id", this.userId).maybeSingle());
    return r ? toProject(r) : null;
  }

  async createProject(i: ProjectInput): Promise<Project> {
    const row = { user_id: this.userId, title: i.title, description: i.description, instructions: i.instructions };
    return toProject(one(await this.sb.from("projects").insert(row).select("*").single()));
  }

  async updateProject(id: string, p: ProjectPatch): Promise<Project | null> {
    const patch: Row = { updated_at: now() };
    for (const k of ["title", "description", "instructions", "archived"] as const) if (p[k] !== undefined) patch[k] = p[k];
    const r = check(await this.sb.from("projects").update(patch).eq("id", id).eq("user_id", this.userId).select("*").maybeSingle());
    return r ? toProject(r) : null;
  }

  async deleteProject(id: string): Promise<boolean> {
    const r = check(await this.sb.from("projects").delete().eq("id", id).eq("user_id", this.userId).select("id"));
    return (r as Row[]).length > 0;
  }

  async listConversations(f: ConversationFilter = {}): Promise<Conversation[]> {
    let q = this.sb.from("conversations").select("*").eq("user_id", this.userId);
    if (f.projectId) q = q.eq("project_id", f.projectId);
    if (f.favorite !== undefined) q = q.eq("favorite", f.favorite);
    const term = f.query?.trim();
    if (term) {
      const like = `%${term.replace(/[%_\\]/g, (c) => "\\" + c)}%`;
      const ids = (check(await this.sb.from("messages").select("conversation_id").eq("user_id", this.userId).ilike("content", like).limit(200)) as Row[]).map(
        (r) => r.conversation_id as string,
      );
      const uniq = [...new Set(ids)];
      q = uniq.length ? q.or(`title.ilike.${JSON.stringify(like)},id.in.(${uniq.join(",")})`) : q.ilike("title", like);
    }
    return (check(await q.order("updated_at", { ascending: false }).limit(f.limit ?? 200)) as Row[]).map(toConversation);
  }

  async getConversation(id: string): Promise<Conversation | null> {
    const r = check(await this.sb.from("conversations").select("*").eq("id", id).eq("user_id", this.userId).maybeSingle());
    return r ? toConversation(r) : null;
  }

  async createConversation(i: ConversationInput): Promise<Conversation> {
    const row = { user_id: this.userId, title: i.title, project_id: i.projectId, mode: i.mode };
    return toConversation(one(await this.sb.from("conversations").insert(row).select("*").single()));
  }

  async updateConversation(id: string, p: ConversationPatch): Promise<Conversation | null> {
    const patch: Row = { updated_at: now() };
    if (p.title !== undefined) patch.title = p.title;
    if (p.favorite !== undefined) patch.favorite = p.favorite;
    if (p.projectId !== undefined) patch.project_id = p.projectId;
    if (p.mode !== undefined) patch.mode = p.mode;
    const res = await this.sb.from("conversations").update(patch).eq("id", id).eq("user_id", this.userId).select("*").maybeSingle();
    if (res.error?.code === "42501") return null; // project not owned
    const r = check(res);
    return r ? toConversation(r) : null;
  }

  async deleteConversation(id: string): Promise<boolean> {
    const r = check(await this.sb.from("conversations").delete().eq("id", id).eq("user_id", this.userId).select("id"));
    return (r as Row[]).length > 0;
  }

  async listMessages(conversationId: string, opts: { limit?: number } = {}): Promise<Message[]> {
    let q = this.sb.from("messages").select("*").eq("conversation_id", conversationId).eq("user_id", this.userId).order("created_at", { ascending: false });
    if (opts.limit) q = q.limit(opts.limit);
    return (check(await q) as Row[]).map(toMessage).reverse();
  }

  async addMessage(conversationId: string, i: MessageInput): Promise<Message | null> {
    const res = await this.sb
      .from("messages")
      .insert({
        conversation_id: conversationId,
        user_id: this.userId,
        role: i.role,
        content: i.content,
        provider: i.provider ?? null,
        model: i.model ?? null,
        status: i.status ?? "complete",
        input_tokens: i.inputTokens ?? 0,
        output_tokens: i.outputTokens ?? 0,
      })
      .select("*")
      .single();
    if (res.error?.code === "42501") return null;
    return toMessage(check(res));
  }

  async deleteMessage(id: string): Promise<boolean> {
    const r = check(await this.sb.from("messages").delete().eq("id", id).eq("user_id", this.userId).select("id"));
    return (r as Row[]).length > 0;
  }

  async listMemories(opts: { consent?: boolean; projectId?: string | null } = {}): Promise<Memory[]> {
    let q = this.sb.from("memories").select("*").eq("user_id", this.userId);
    if (opts.consent !== undefined) q = q.eq("consent", opts.consent);
    if (opts.projectId !== undefined) q = opts.projectId ? q.or(`project_id.is.null,project_id.eq.${opts.projectId}`) : q.is("project_id", null);
    return (check(await q.order("updated_at", { ascending: false })) as Row[]).map(toMemory);
  }

  async createMemory(i: MemoryInput): Promise<Memory> {
    const row = {
      user_id: this.userId,
      project_id: i.projectId,
      content: i.content,
      source: i.source,
      source_conversation_id: i.sourceConversationId,
      consent: i.consent,
    };
    return toMemory(one(await this.sb.from("memories").insert(row).select("*").single()));
  }

  async updateMemory(id: string, p: MemoryPatch): Promise<Memory | null> {
    const patch: Row = { updated_at: now() };
    if (p.content !== undefined) patch.content = p.content;
    if (p.consent !== undefined) patch.consent = p.consent;
    const r = check(await this.sb.from("memories").update(patch).eq("id", id).eq("user_id", this.userId).select("*").maybeSingle());
    return r ? toMemory(r) : null;
  }

  async deleteMemory(id: string): Promise<boolean> {
    const r = check(await this.sb.from("memories").delete().eq("id", id).eq("user_id", this.userId).select("id"));
    return (r as Row[]).length > 0;
  }

  async deleteAllMemories(): Promise<number> {
    const r = check(await this.sb.from("memories").delete().eq("user_id", this.userId).select("id"));
    return (r as Row[]).length;
  }

  async recordUsage(i: UsageInput): Promise<void> {
    check(
      await this.sb.from("usage_events").insert({
        user_id: this.userId,
        provider: i.provider,
        model: i.model,
        input_tokens: i.inputTokens,
        output_tokens: i.outputTokens,
        cost: i.cost,
        status: i.status,
      }),
    );
  }

  async countRequests(since: Date): Promise<number> {
    const res = await this.sb.from("usage_events").select("id", { count: "exact", head: true }).eq("user_id", this.userId).gte("created_at", since.toISOString());
    if (res.error) throw new Error(`Database error: ${res.error.message}`);
    return res.count ?? 0;
  }

  async listUsage(since: Date): Promise<UsageEvent[]> {
    return (
      check(await this.sb.from("usage_events").select("*").eq("user_id", this.userId).gte("created_at", since.toISOString()).order("created_at")) as Row[]
    ).map(toUsage);
  }

  async exportAll(): Promise<UserExport> {
    const [profile, projects, conversations, memories, usage] = await Promise.all([
      this.getProfile(),
      this.listProjects({ includeArchived: true }),
      this.listConversations({ limit: 10_000 }),
      this.listMemories(),
      this.listUsage(new Date(0)),
    ]);
    const withMessages = await Promise.all(conversations.map(async (c) => ({ ...c, messages: await this.listMessages(c.id) })));
    return { exportedAt: now(), profile, projects, conversations: withMessages, memories, usage };
  }

  async deleteAccount(): Promise<void> {
    check(await this.sb.rpc("delete_my_account"));
  }
}

export class SupabaseGlobalUsage implements GlobalUsage {
  constructor(private readonly sb: SupabaseClient) {}
  private async get(since: Date, perUserCap: number): Promise<{ requests: number; cost: number }> {
    const rows = check(await this.sb.rpc("global_usage_since", { since: since.toISOString(), per_user_cap: perUserCap })) as Row[];
    return { requests: Number(rows?.[0]?.requests ?? 0), cost: Number(rows?.[0]?.cost ?? 0) };
  }
  async countRequests(since: Date, perUserCap: number) {
    return (await this.get(since, perUserCap)).requests;
  }
  async sumCost(since: Date) {
    return (await this.get(since, 1_000_000)).cost;
  }
}
