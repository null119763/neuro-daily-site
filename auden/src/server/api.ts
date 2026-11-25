import { MODES } from "@/core/types";
import { startOfUtcDay } from "@/core/quota";
import {
  conversationCreateSchema,
  conversationPatchSchema,
  credentialsSchema,
  deriveTitle,
  isUuid,
  LIMITS,
  memoryCreateSchema,
  memoryPatchSchema,
  profilePatchSchema,
  projectCreateSchema,
  projectPatchSchema,
  signUpSchema,
} from "@/domain/validation";
import type { Session } from "./backend";
import { prepareChat, type ChatStreamEvent } from "./chat-service";
import { assertSameOrigin, errorJson, HttpError, json, readJson, RequestCookieJar } from "./http";
import type { Runtime } from "./runtime";
import type { z } from "zod";

type Ctx = { req: Request; rt: Runtime; jar: RequestCookieJar; url: URL; params: string[] };
type Handler = (ctx: Ctx) => Promise<Response>;

function parse<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) throw new HttpError(400, "validation_error", r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  return r.data;
}

async function requireSession(ctx: Ctx): Promise<Session> {
  const s = await ctx.rt.backend.getSession(ctx.jar);
  if (!s) throw new HttpError(401, "unauthorized");
  return s;
}

function idParam(ctx: Ctx, i = 0): string {
  const id = ctx.params[i];
  if (!id || !isUuid(id)) throw new HttpError(404, "not_found");
  return id;
}

const notFound = () => errorJson(404, "not_found");

// ---------------- auth
const signUp: Handler = async (ctx) => {
  const input = parse(signUpSchema, await readJson(ctx.req));
  const r = await ctx.rt.backend.signUp(ctx.jar, { email: input.email, password: input.password, displayName: input.displayName ?? null });
  if (!r.ok) return errorJson(r.code === "email_taken" ? 409 : r.code === "signups_closed" ? 403 : 400, r.code);
  return json({ ok: true, needsEmailConfirmation: r.needsEmailConfirmation ?? false }, 201);
};

const signIn: Handler = async (ctx) => {
  const input = parse(credentialsSchema, await readJson(ctx.req));
  const r = await ctx.rt.backend.signIn(ctx.jar, input);
  if (!r.ok) return errorJson(401, r.code);
  return json({ ok: true });
};

const signOut: Handler = async (ctx) => {
  await ctx.rt.backend.signOut(ctx.jar);
  return json({ ok: true });
};

const sessionInfo: Handler = async (ctx) => {
  const s = await ctx.rt.backend.getSession(ctx.jar);
  if (!s) return json({ user: null, backend: ctx.rt.backend.kind, signupsOpen: ctx.rt.config.signupsOpen });
  return json({ user: s.user, profile: await s.store.getProfile(), backend: ctx.rt.backend.kind, signupsOpen: ctx.rt.config.signupsOpen });
};

// ---------------- profile & account
const getProfile: Handler = async (ctx) => json(await (await requireSession(ctx)).store.getProfile());
const patchProfile: Handler = async (ctx) => {
  const s = await requireSession(ctx);
  const patch = parse(profilePatchSchema, await readJson(ctx.req));
  return json(await s.store.updateProfile(patch));
};
const exportAccount: Handler = async (ctx) => {
  const s = await requireSession(ctx);
  const data = await s.store.exportAll();
  return json(data, 200, { "Content-Disposition": `attachment; filename="auden-export-${data.exportedAt.slice(0, 10)}.json"` });
};
const deleteAccount: Handler = async (ctx) => {
  const s = await requireSession(ctx);
  const body = (await readJson(ctx.req)) as { confirm?: string };
  if (body.confirm !== "DELETE") throw new HttpError(400, "confirmation_required");
  await s.store.deleteAccount();
  await ctx.rt.backend.signOut(ctx.jar).catch(() => undefined);
  return json({ ok: true });
};

// ---------------- projects
const listProjects: Handler = async (ctx) => {
  const s = await requireSession(ctx);
  return json(await s.store.listProjects({ includeArchived: ctx.url.searchParams.get("archived") === "1" }));
};
const createProject: Handler = async (ctx) => {
  const s = await requireSession(ctx);
  const input = parse(projectCreateSchema, await readJson(ctx.req));
  return json(await s.store.createProject({ title: input.title, description: input.description ?? null, instructions: input.instructions ?? null }), 201);
};
const getProject: Handler = async (ctx) => {
  const s = await requireSession(ctx);
  const p = await s.store.getProject(idParam(ctx));
  return p ? json(p) : notFound();
};
const patchProject: Handler = async (ctx) => {
  const s = await requireSession(ctx);
  const p = await s.store.updateProject(idParam(ctx), parse(projectPatchSchema, await readJson(ctx.req)));
  return p ? json(p) : notFound();
};
const deleteProject: Handler = async (ctx) => {
  const s = await requireSession(ctx);
  return (await s.store.deleteProject(idParam(ctx))) ? json({ ok: true }) : notFound();
};

// ---------------- conversations
const listConversations: Handler = async (ctx) => {
  const s = await requireSession(ctx);
  const sp = ctx.url.searchParams;
  const projectId = sp.get("projectId") ?? undefined;
  if (projectId && !isUuid(projectId)) return json([]);
  return json(
    await s.store.listConversations({
      projectId,
      favorite: sp.get("favorite") === "1" ? true : undefined,
      query: sp.get("q")?.slice(0, LIMITS.search) || undefined,
    }),
  );
};
const createConversation: Handler = async (ctx) => {
  const s = await requireSession(ctx);
  const input = parse(conversationCreateSchema, await readJson(ctx.req));
  if (input.projectId && !(await s.store.getProject(input.projectId))) return notFound();
  const profile = await s.store.getProfile();
  const c = await s.store.createConversation({
    title: input.title ? deriveTitle(input.title) : profile.locale === "en" ? "New chat" : "Новый чат",
    projectId: input.projectId ?? null,
    mode: input.mode ?? profile.defaultMode,
  });
  return json(c, 201);
};
const getConversation: Handler = async (ctx) => {
  const s = await requireSession(ctx);
  const c = await s.store.getConversation(idParam(ctx));
  if (!c) return notFound();
  return json({ ...c, messages: await s.store.listMessages(c.id) });
};
const patchConversation: Handler = async (ctx) => {
  const s = await requireSession(ctx);
  const c = await s.store.updateConversation(idParam(ctx), parse(conversationPatchSchema, await readJson(ctx.req)));
  return c ? json(c) : notFound();
};
const deleteConversation: Handler = async (ctx) => {
  const s = await requireSession(ctx);
  return (await s.store.deleteConversation(idParam(ctx))) ? json({ ok: true }) : notFound();
};

// ---------------- memory
const listMemory: Handler = async (ctx) => {
  const s = await requireSession(ctx);
  const status = ctx.url.searchParams.get("status");
  return json(await s.store.listMemories({ consent: status === "pending" ? false : status === "confirmed" ? true : undefined }));
};
const createMemory: Handler = async (ctx) => {
  const s = await requireSession(ctx);
  const input = parse(memoryCreateSchema, await readJson(ctx.req));
  if (input.projectId && !(await s.store.getProject(input.projectId))) return notFound();
  // Manually added by the user = explicit consent.
  return json(await s.store.createMemory({ content: input.content, projectId: input.projectId ?? null, source: "manual", sourceConversationId: null, consent: true }), 201);
};
const patchMemory: Handler = async (ctx) => {
  const s = await requireSession(ctx);
  const m = await s.store.updateMemory(idParam(ctx), parse(memoryPatchSchema, await readJson(ctx.req)));
  return m ? json(m) : notFound();
};
const deleteMemory: Handler = async (ctx) => {
  const s = await requireSession(ctx);
  return (await s.store.deleteMemory(idParam(ctx))) ? json({ ok: true }) : notFound();
};
const deleteAllMemory: Handler = async (ctx) => {
  const s = await requireSession(ctx);
  return json({ deleted: await s.store.deleteAllMemories() });
};

// ---------------- usage & models
const usage: Handler = async (ctx) => {
  const s = await requireSession(ctx);
  const today = startOfUtcDay(new Date());
  const events = await s.store.listUsage(today);
  return json({
    today: {
      requests: events.length,
      inputTokens: events.reduce((a, e) => a + e.inputTokens, 0),
      outputTokens: events.reduce((a, e) => a + e.outputTokens, 0),
      cost: events.reduce((a, e) => a + e.cost, 0),
    },
    limits: { perDay: ctx.rt.config.limits.userPerDay, perMinute: ctx.rt.config.limits.userPerMinute },
    resetsAt: new Date(today.getTime() + 86_400_000).toISOString(),
  });
};

const models: Handler = async (ctx) => {
  await requireSession(ctx);
  const routes = await Promise.all(
    MODES.map(async (mode) => {
      try {
        return { mode, route: (await ctx.rt.resolveRoute(mode)).slice(0, 3) };
      } catch {
        return { mode, route: [] };
      }
    }),
  );
  const providers = [...ctx.rt.providers.values()].map((p) => ({ id: p.id, label: p.label, configured: p.isConfigured() }));
  return json({ modes: routes, providers, paidModelsEnabled: false });
};

// ---------------- chat (SSE)
const chat: Handler = async (ctx) => {
  const s = await requireSession(ctx);
  const pre = await prepareChat(s, ctx.rt.engine, ctx.rt.config, await readJson(ctx.req));
  if (!pre.ok) return errorJson(pre.status, pre.code, pre.message, pre.retryAfterSec ? { retryAfterSec: pre.retryAfterSec } : {});

  const abort = new AbortController();
  ctx.req.signal?.addEventListener("abort", () => abort.abort(), { once: true });
  const enc = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (ev: ChatStreamEvent) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`));
        } catch {
          closed = true;
        }
      };
      try {
        // The generator runs to completion even if the client disconnects, so partial answers are persisted.
        for await (const ev of pre.run(abort.signal)) send(ev);
      } catch (err) {
        console.error("[chat] stream failure", (err as Error).message);
        send({ type: "error", code: "server_error", message: "Internal error", saved: null });
      } finally {
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
      }
    },
    cancel() {
      closed = true;
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
};

// ---------------- router
type Route = [method: string, pattern: string, handler: Handler];
const routes: Route[] = [
  ["POST", "auth/signup", signUp],
  ["POST", "auth/signin", signIn],
  ["POST", "auth/signout", signOut],
  ["GET", "auth/session", sessionInfo],
  ["GET", "profile", getProfile],
  ["PATCH", "profile", patchProfile],
  ["GET", "account/export", exportAccount],
  ["DELETE", "account", deleteAccount],
  ["POST", "chat", chat],
  ["GET", "conversations", listConversations],
  ["POST", "conversations", createConversation],
  ["GET", "conversations/:id", getConversation],
  ["PATCH", "conversations/:id", patchConversation],
  ["DELETE", "conversations/:id", deleteConversation],
  ["GET", "projects", listProjects],
  ["POST", "projects", createProject],
  ["GET", "projects/:id", getProject],
  ["PATCH", "projects/:id", patchProject],
  ["DELETE", "projects/:id", deleteProject],
  ["GET", "memory", listMemory],
  ["POST", "memory", createMemory],
  ["DELETE", "memory", deleteAllMemory],
  ["PATCH", "memory/:id", patchMemory],
  ["DELETE", "memory/:id", deleteMemory],
  ["GET", "usage", usage],
  ["GET", "models", models],
];

function match(pattern: string, path: string): string[] | null {
  const p = pattern.split("/");
  const s = path.split("/").filter(Boolean);
  if (p.length !== s.length) return null;
  const params: string[] = [];
  for (let i = 0; i < p.length; i++) {
    if (p[i]!.startsWith(":")) params.push(decodeURIComponent(s[i]!));
    else if (p[i] !== s[i]) return null;
  }
  return params;
}

/** Entry point for all /api/* requests. */
export async function handleApi(req: Request, rt: Runtime): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api\/?/, "").replace(/\/$/, "");
  const jar = new RequestCookieJar(req);
  let matchedPath = false;
  try {
    for (const [method, pattern, handler] of routes) {
      const params = match(pattern, path);
      if (!params) continue;
      matchedPath = true;
      if (method !== req.method) continue;
      assertSameOrigin(req);
      return jar.apply(await handler({ req, rt, jar, url, params }));
    }
    return matchedPath ? errorJson(405, "method_not_allowed") : errorJson(404, "not_found");
  } catch (err) {
    if (err instanceof HttpError) return jar.apply(errorJson(err.status, err.code, err.message));
    console.error("[api] unhandled", req.method, path, (err as Error).message);
    return errorJson(500, "server_error", "Internal error");
  }
}
