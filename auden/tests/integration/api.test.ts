import { beforeEach, describe, expect, it } from "vitest";
import { MockProvider } from "@/core/providers/mock";
import type { ChatMessage, ModelProvider, StreamRequest } from "@/core/types";
import { LocalBackend } from "@/server/backend";
import { loadConfig } from "@/server/config";
import { handleApi } from "@/server/api";
import { createRuntime, type Runtime } from "@/server/runtime";
import { LocalDatabase } from "@/persistence/local-db";

/** Mock provider that records the prompts it receives. */
class SpyProvider extends MockProvider {
  prompts: ChatMessage[][] = [];
  override stream(req: StreamRequest) {
    this.prompts.push(req.messages);
    return super.stream(req);
  }
}

function makeRuntime(env: Record<string, string> = {}) {
  const config = loadConfig({ AUDEN_LOCAL_DATA_FILE: "memory", ...env } as unknown as NodeJS.ProcessEnv);
  const spy = new SpyProvider({ delayMs: 0 });
  const rt = createRuntime(config, {
    backend: new LocalBackend(config, new LocalDatabase(null), false),
    providers: new Map<string, ModelProvider>([["mock", spy]]),
  });
  return { rt, spy };
}

class Client {
  private cookies = new Map<string, string>();
  constructor(private readonly rt: Runtime) {}

  async call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Response> {
    const h: Record<string, string> = { host: "localhost", ...headers };
    if (body !== undefined) h["content-type"] = "application/json";
    if (this.cookies.size) h.cookie = [...this.cookies].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("; ");
    const res = await handleApi(new Request(`http://localhost/api/${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), this.rt);
    for (const sc of res.headers.getSetCookie()) {
      const [pair] = sc.split(";");
      const i = pair!.indexOf("=");
      const name = pair!.slice(0, i);
      const value = decodeURIComponent(pair!.slice(i + 1));
      if (/Max-Age=0/.test(sc)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    return res;
  }

  async json<T = any>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
    const res = await this.call(method, path, body);
    return { status: res.status, data: (await res.json()) as T };
  }

  async chat(body: Record<string, unknown>): Promise<{ status: number; events: any[] }> {
    const res = await this.call("POST", "chat", body);
    if (!res.headers.get("content-type")?.includes("event-stream")) return { status: res.status, events: [await res.json()] };
    const text = await res.text();
    const events = text
      .split("\n\n")
      .filter((b) => b.includes("data: "))
      .map((b) => JSON.parse(b.slice(b.indexOf("data: ") + 6)));
    return { status: res.status, events };
  }

  async signUp(email: string) {
    return this.json("POST", "auth/signup", { email, password: "correct horse", displayName: email.split("@")[0], acceptTerms: true });
  }
}

let rt: Runtime;
let spy: SpyProvider;
let alice: Client;
let bob: Client;

beforeEach(async () => {
  ({ rt, spy } = makeRuntime());
  alice = new Client(rt);
  bob = new Client(rt);
  expect((await alice.signUp("alice@test.dev")).status).toBe(201);
  expect((await bob.signUp("bob@test.dev")).status).toBe(201);
});

describe("auth", () => {
  it("reports session, rejects duplicates and bad passwords, signs out", async () => {
    const s = await alice.json("GET", "auth/session");
    expect(s.data.user.email).toBe("alice@test.dev");
    expect(s.data.profile.displayName).toBe("alice");

    expect((await new Client(rt).signUp("alice@test.dev")).status).toBe(409);
    const anon = new Client(rt);
    expect((await anon.json("POST", "auth/signin", { email: "alice@test.dev", password: "wrong password" })).status).toBe(401);
    expect((await anon.json("POST", "auth/signin", { email: "ALICE@test.dev", password: "correct horse" })).status).toBe(200);
    expect((await anon.json("GET", "conversations")).status).toBe(200);

    await alice.json("POST", "auth/signout", {});
    expect((await alice.json("GET", "conversations")).status).toBe(401);
  });

  it("requires accepting terms and a sane password", async () => {
    const c = new Client(rt);
    expect((await c.json("POST", "auth/signup", { email: "x@test.dev", password: "short", acceptTerms: true })).status).toBe(400);
    expect((await c.json("POST", "auth/signup", { email: "x@test.dev", password: "long enough", acceptTerms: false })).status).toBe(400);
  });

  it("allows only invited emails in allowlist mode", async () => {
    const alpha = makeRuntime({ AUDEN_SIGNUP_MODE: "allowlist", AUDEN_ALLOWED_EMAILS: "vip@test.dev,@team.dev" });
    expect((await new Client(alpha.rt).signUp("stranger@test.dev")).status).toBe(403);
    const r = await new Client(alpha.rt).signUp("stranger@test.dev");
    expect(r.data.error.code).toBe("not_invited");
    expect((await new Client(alpha.rt).signUp("vip@test.dev")).status).toBe(201);
    expect((await new Client(alpha.rt).signUp("dev@team.dev")).status).toBe(201);
    const s = await new Client(alpha.rt).json("GET", "auth/session");
    expect(s.data.signupMode).toBe("allowlist");
  });

  it("locks sign-in after repeated wrong passwords, without blocking other accounts", async () => {
    const anon = new Client(rt);
    for (let i = 0; i < 5; i++) {
      expect((await anon.json("POST", "auth/signin", { email: "alice@test.dev", password: "wrong password" })).status).toBe(401);
    }
    const locked = await anon.call("POST", "auth/signin", { email: "alice@test.dev", password: "correct horse" });
    expect(locked.status).toBe(429);
    expect(Number(locked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await locked.json()).error.code).toBe("too_many_attempts");
    expect((await anon.json("POST", "auth/signin", { email: "bob@test.dev", password: "correct horse" })).status).toBe(200);
  });

  it("limits sign-ups per IP", async () => {
    const fresh = makeRuntime();
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await new Client(fresh.rt).call("POST", "auth/signup", { email: `u${i}@test.dev`, password: "correct horse", acceptTerms: true }, { "x-forwarded-for": "198.51.100.7" });
      statuses.push(res.status);
    }
    expect(statuses).toEqual([201, 201, 201, 201, 201, 429]);
  });

  it("can close sign-ups", async () => {
    const closed = makeRuntime({ AUDEN_SIGNUP_MODE: "closed" });
    expect((await new Client(closed.rt).signUp("c@test.dev")).status).toBe(403);
  });
});

describe("chat streaming and history", () => {
  it("streams an answer, persists it, and reuses history", async () => {
    const r = await alice.chat({ message: "Привет! Помоги с планом" });
    expect(r.status).toBe(200);
    const types = r.events.map((e) => e.type);
    expect(types[0]).toBe("start");
    expect(types[1]).toBe("route");
    expect(types).toContain("delta");
    expect(types.at(-1)).toBe("done");
    const done = r.events.at(-1);
    expect(done.message.provider).toBe("mock");
    expect(done.message.model).toBe("mock-core");
    const convId = r.events[0].conversation.id;
    expect(r.events[0].conversation.title).toBe("Привет! Помоги с планом");

    const c = await alice.json("GET", `conversations/${convId}`);
    expect(c.data.messages.map((m: any) => m.role)).toEqual(["user", "assistant"]);
    expect(c.data.messages[1].content).toBe(r.events.filter((e) => e.type === "delta").map((e) => e.text).join(""));

    await alice.chat({ conversationId: convId, message: "Продолжай", mode: "prime" });
    const last = spy.prompts.at(-1)!;
    expect(last.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
    expect((await alice.json("GET", `conversations/${convId}`)).data.mode).toBe("prime");
  });

  it("includes project instructions and confirmed memories only", async () => {
    const p = await alice.json("POST", "projects", { title: "Игра", instructions: "Жанр — стратегия" });
    await alice.json("POST", "memory", { content: "Пользователь — дизайнер" });
    const r = await alice.chat({ message: "Запомни, что я люблю зелёный чай", projectId: p.data.id });
    const proposal = r.events[0].memoryProposal;
    expect(proposal).toMatchObject({ content: "я люблю зелёный чай", consent: false, source: "chat" });
    const sys1 = spy.prompts.at(-1)![0]!.content;
    expect(sys1).toContain("Жанр — стратегия");
    expect(sys1).toContain("Пользователь — дизайнер");
    expect(sys1).not.toContain("зелёный чай");

    await alice.json("PATCH", `memory/${proposal.id}`, { consent: true });
    await alice.chat({ conversationId: r.events[0].conversation.id, message: "Ещё" });
    expect(spy.prompts.at(-1)![0]!.content).toContain("зелёный чай");

    await alice.json("PATCH", "profile", { memoryEnabled: false });
    await alice.chat({ message: "Новый вопрос" });
    expect(spy.prompts.at(-1)![0]!.content).not.toContain("дизайнер");
  });

  it("isolates project memories from other projects", async () => {
    const p1 = (await alice.json("POST", "projects", { title: "P1" })).data;
    const p2 = (await alice.json("POST", "projects", { title: "P2" })).data;
    await alice.json("POST", "memory", { content: "секрет проекта один", projectId: p1.id });
    await alice.chat({ message: "q", projectId: p2.id });
    expect(spy.prompts.at(-1)![0]!.content).not.toContain("секрет проекта один");
    await alice.chat({ message: "q", projectId: p1.id });
    expect(spy.prompts.at(-1)![0]!.content).toContain("секрет проекта один");
  });

  it("regenerates the last answer without duplicating the user message", async () => {
    const first = await alice.chat({ message: "Вопрос один" });
    const convId = first.events[0].conversation.id;
    await alice.chat({ conversationId: convId, message: "Вопрос два" });
    const before = (await alice.json("GET", `conversations/${convId}`)).data.messages;
    expect(before.map((m: any) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);

    const r = await alice.chat({ conversationId: convId, regenerate: true });
    expect(r.status).toBe(200);
    expect(r.events[0].userMessage.id).toBe(before[2].id);
    expect(r.events.at(-1).type).toBe("done");
    // The prompt ends with the regenerated user turn and does not contain the old answer twice
    const prompt = spy.prompts.at(-1)!;
    expect(prompt.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(prompt.at(-1)!.content).toBe("Вопрос два");

    const after = (await alice.json("GET", `conversations/${convId}`)).data.messages;
    expect(after.map((m: any) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(after[3].id).not.toBe(before[3].id);
    expect(after[2].id).toBe(before[2].id);
  });

  it("keeps the old answer when regeneration fails, and answers an unanswered message", async () => {
    const first = await alice.chat({ message: "/mock-error unavailable" });
    const convId = first.events[0].conversation.id;
    expect((await alice.json("GET", `conversations/${convId}`)).data.messages.map((m: any) => m.role)).toEqual(["user"]);
    const retry = await alice.chat({ conversationId: convId, regenerate: true });
    expect(retry.events.at(-1)).toMatchObject({ type: "error", code: "unavailable" });
    expect((await alice.json("GET", `conversations/${convId}`)).data.messages).toHaveLength(1);

    const ok = await alice.chat({ message: "Нормальный вопрос" });
    const okId = ok.events[0].conversation.id;
    const answer = ok.events.at(-1).message.id;
    // Make the provider fail for the regeneration and check the original answer survives
    const original = spy.stream.bind(spy);
    spy.stream = async function* () {
      throw new (await import("@/core/types")).ProviderError("unavailable", "down");
    } as typeof spy.stream;
    const failed = await alice.chat({ conversationId: okId, regenerate: true });
    spy.stream = original;
    expect(failed.events.at(-1)).toMatchObject({ type: "error", code: "unavailable" });
    const msgs = (await alice.json("GET", `conversations/${okId}`)).data.messages;
    expect(msgs.map((m: any) => m.id)).toContain(answer);
  });

  it("validates regenerate requests", async () => {
    expect((await alice.chat({ regenerate: true })).status).toBe(400);
    const c = (await alice.json("POST", "conversations", {})).data;
    const r = await alice.chat({ conversationId: c.id, regenerate: true });
    expect(r.status).toBe(400);
    expect(r.events[0].error.code).toBe("nothing_to_regenerate");
    expect((await bob.chat({ conversationId: c.id, regenerate: true })).status).toBe(404);
    expect((await alice.chat({ conversationId: c.id, regenerate: true, message: "x" })).status).toBe(400);
  });

  it("reports provider errors and records usage", async () => {
    const r = await alice.chat({ message: "/mock-error unavailable" });
    expect(r.events.at(-1)).toMatchObject({ type: "error", code: "unavailable" });
    const u = await alice.json("GET", "usage");
    expect(u.data.today.requests).toBe(1);
  });

  it("rejects oversized input and invalid ids", async () => {
    expect((await alice.chat({ message: "x".repeat(9000) })).status).toBe(413);
    expect((await alice.chat({ message: "" })).status).toBe(400);
    expect((await alice.json("GET", "conversations/not-a-uuid")).status).toBe(404);
  });
});

describe("quotas", () => {
  it("enforces per-minute limit server-side", async () => {
    const limited = makeRuntime({ AUDEN_USER_PER_MINUTE: "2" });
    const c = new Client(limited.rt);
    await c.signUp("q@test.dev");
    expect((await c.chat({ message: "1" })).status).toBe(200);
    expect((await c.chat({ message: "2" })).status).toBe(200);
    const third = await c.call("POST", "chat", { message: "3" });
    expect(third.status).toBe(429);
    expect(third.headers.get("retry-after")).toBe("60");
    expect((await third.json()).error.code).toBe("rate_limited");
  });

  it("enforces a global daily ceiling across users", async () => {
    const limited = makeRuntime({ AUDEN_GLOBAL_DAILY_REQUESTS: "1" });
    const a = new Client(limited.rt);
    const b = new Client(limited.rt);
    await a.signUp("a@test.dev");
    await b.signUp("b@test.dev");
    expect((await a.chat({ message: "1" })).status).toBe(200);
    const r = await b.chat({ message: "2" });
    expect(r.status).toBe(429);
    expect(r.events[0].error.code).toBe("global_daily");
  });
});

describe("two accounts never see each other's data", () => {
  it("isolates conversations, messages, projects and memories", async () => {
    const project = (await alice.json("POST", "projects", { title: "Alice project" })).data;
    const chat = await alice.chat({ message: "секрет Алисы", projectId: project.id });
    const convId = chat.events[0].conversation.id;
    const memory = (await alice.json("POST", "memory", { content: "Alice fact" })).data;

    // listings are empty for Bob
    expect((await bob.json("GET", "conversations")).data).toEqual([]);
    expect((await bob.json("GET", "conversations?q=секрет")).data).toEqual([]);
    expect((await bob.json("GET", "projects")).data).toEqual([]);
    expect((await bob.json("GET", "memory")).data).toEqual([]);

    // direct access is 404, not 403 (no existence leak)
    expect((await bob.json("GET", `conversations/${convId}`)).status).toBe(404);
    expect((await bob.json("GET", `projects/${project.id}`)).status).toBe(404);
    expect((await bob.json("PATCH", `conversations/${convId}`, { title: "hacked" })).status).toBe(404);
    expect((await bob.json("DELETE", `conversations/${convId}`)).status).toBe(404);
    expect((await bob.json("PATCH", `projects/${project.id}`, { title: "hacked" })).status).toBe(404);
    expect((await bob.json("DELETE", `projects/${project.id}`)).status).toBe(404);
    expect((await bob.json("PATCH", `memory/${memory.id}`, { content: "hacked" })).status).toBe(404);
    expect((await bob.json("DELETE", `memory/${memory.id}`)).status).toBe(404);

    // Bob cannot write into Alice's conversation or project
    expect((await bob.chat({ conversationId: convId, message: "inject" })).status).toBe(404);
    expect((await bob.chat({ message: "x", projectId: project.id })).status).toBe(404);
    expect((await bob.json("POST", "conversations", { projectId: project.id })).status).toBe(404);
    expect((await bob.json("POST", "memory", { content: "x", projectId: project.id })).status).toBe(404);
    const own = (await bob.json("POST", "conversations", {})).data;
    expect((await bob.json("PATCH", `conversations/${own.id}`, { projectId: project.id })).status).toBe(404);

    // Bob deleting all his memories does not touch Alice's
    await bob.json("DELETE", "memory");
    expect((await alice.json("GET", "memory")).data).toHaveLength(1);

    // Alice's data is intact
    const c = await alice.json("GET", `conversations/${convId}`);
    expect(c.data.title).toBe("секрет Алисы");
    expect(c.data.messages).toHaveLength(2);
    expect((await bob.json("GET", "usage")).data.today.requests).toBe(0);
  });
});

describe("management", () => {
  it("renames, favourites, searches and deletes conversations", async () => {
    const r = await alice.chat({ message: "Архитектура приложения" });
    const id = r.events[0].conversation.id;
    await alice.chat({ message: "Другое" });
    expect((await alice.json("PATCH", `conversations/${id}`, { title: "Новое имя", favorite: true })).data.favorite).toBe(true);
    expect((await alice.json("GET", "conversations?favorite=1")).data.map((c: any) => c.id)).toEqual([id]);
    expect((await alice.json("GET", "conversations?q=архитектура")).data.map((c: any) => c.id)).toEqual([id]);
    expect((await alice.json("DELETE", `conversations/${id}`)).status).toBe(200);
    expect((await alice.json("GET", `conversations/${id}`)).status).toBe(404);
    expect((await alice.json("GET", "conversations")).data).toHaveLength(1);
  });

  it("deleting a project keeps its conversations", async () => {
    const p = (await alice.json("POST", "projects", { title: "P" })).data;
    const r = await alice.chat({ message: "hi", projectId: p.id });
    await alice.json("DELETE", `projects/${p.id}`);
    const c = await alice.json("GET", `conversations/${r.events[0].conversation.id}`);
    expect(c.status).toBe(200);
    expect(c.data.projectId).toBeNull();
  });

  it("edits, deletes and bulk-deletes memories", async () => {
    const m = (await alice.json("POST", "memory", { content: "fact 1" })).data;
    await alice.json("POST", "memory", { content: "fact 2" });
    expect((await alice.json("PATCH", `memory/${m.id}`, { content: "fact one" })).data.content).toBe("fact one");
    expect((await alice.json("DELETE", `memory/${m.id}`)).status).toBe(200);
    expect((await alice.json("GET", "memory")).data).toHaveLength(1);
    expect((await alice.json("DELETE", "memory")).data.deleted).toBe(1);
    expect((await alice.json("GET", "memory")).data).toHaveLength(0);
  });

  it("exports and deletes the account", async () => {
    await alice.chat({ message: "hello" });
    const exp = await alice.call("GET", "account/export");
    expect(exp.headers.get("content-disposition")).toContain("auden-export-");
    const data = await exp.json();
    expect(data.conversations[0].messages).toHaveLength(2);
    expect(data.profile.email).toBe("alice@test.dev");

    expect((await alice.json("DELETE", "account", {})).status).toBe(400);
    expect((await alice.json("DELETE", "account", { confirm: "DELETE" })).status).toBe(200);
    expect((await alice.json("GET", "conversations")).status).toBe(401);
    expect((await new Client(rt).json("POST", "auth/signin", { email: "alice@test.dev", password: "correct horse" })).status).toBe(401);
  });

  it("validates profile updates", async () => {
    expect((await alice.json("PATCH", "profile", { theme: "dark", locale: "en", defaultMode: "air" })).data).toMatchObject({ theme: "dark", locale: "en", defaultMode: "air" });
    expect((await alice.json("PATCH", "profile", { theme: "neon" })).status).toBe(400);
    expect((await alice.json("PATCH", "profile", { email: "x@y.z" })).status).toBe(400);
  });
});

describe("http hardening", () => {
  it("rejects cross-origin mutations and non-JSON bodies", async () => {
    const res = await alice.call("POST", "projects", { title: "x" }, { origin: "https://evil.example" });
    expect(res.status).toBe(403);
    const res2 = await alice.call("POST", "projects", undefined, { "content-type": "text/plain" });
    expect(res2.status).toBe(415);
    expect((await alice.call("PUT", "projects")).status).toBe(405);
    expect((await alice.call("GET", "nope")).status).toBe(404);
  });

  it("exposes model routing without secrets", async () => {
    const r = await alice.json("GET", "models");
    expect(r.data.paidModelsEnabled).toBe(false);
    expect(r.data.modes.map((m: any) => m.mode)).toEqual(["air", "core", "prime"]);
    expect(JSON.stringify(r.data)).not.toMatch(/key/i);
  });
});
