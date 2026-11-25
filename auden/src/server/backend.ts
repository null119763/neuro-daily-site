import { createServerClient } from "@supabase/ssr";
import { AuthError, LocalAuth } from "@/auth/local-auth";
import type { AuthUser } from "@/domain/types";
import { LocalDatabase } from "@/persistence/local-db";
import { LocalGlobalUsage, LocalUserStore } from "@/persistence/local-store";
import type { GlobalUsage, UserStore } from "@/persistence/store";
import { SupabaseGlobalUsage, SupabaseUserStore } from "@/persistence/supabase-store";
import { isEmailAllowed, type AppConfig } from "./config";
import type { MetricsData } from "./metrics";

export interface CookieOptions {
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "lax" | "strict" | "none";
  path?: string;
  maxAge?: number;
  expires?: Date;
}

/** Framework-neutral cookie access (adapted from Next.js cookies() in route handlers). */
export interface CookieJar {
  get(name: string): string | undefined;
  getAll(): { name: string; value: string }[];
  set(name: string, value: string, options?: CookieOptions): void;
}

export interface Session {
  user: AuthUser;
  store: UserStore;
  global: GlobalUsage;
}

export type AuthResult =
  | { ok: true; needsEmailConfirmation?: boolean }
  | { ok: false; code: "email_taken" | "invalid_credentials" | "signups_closed" | "not_invited" | "auth_error"; message?: string };

/** Shared sign-up gate. The Supabase database enforces the same rule with a trigger (see migrations). */
export function signupGate(cfg: Pick<AppConfig, "signupMode" | "allowedEmails">, email: string): AuthResult | null {
  if (cfg.signupMode === "closed") return { ok: false, code: "signups_closed" };
  if (!isEmailAllowed(email, cfg)) return { ok: false, code: "not_invited" };
  return null;
}

export interface Backend {
  readonly kind: "local" | "supabase";
  signUp(jar: CookieJar, input: { email: string; password: string; displayName: string | null }): Promise<AuthResult>;
  signIn(jar: CookieJar, input: { email: string; password: string }): Promise<AuthResult>;
  signOut(jar: CookieJar): Promise<void>;
  getSession(jar: CookieJar): Promise<Session | null>;
  isAdmin(jar: CookieJar, session: Session): Promise<boolean>;
  /** Aggregate-ready data without message content, or null if the caller is not an admin. */
  adminMetricsData(jar: CookieJar, session: Session, since: Date): Promise<MetricsData | null>;
}

export const LOCAL_SESSION_COOKIE = "auden_session";

export class LocalBackend implements Backend {
  readonly kind = "local" as const;
  readonly db: LocalDatabase;
  private readonly auth: LocalAuth;
  private readonly global: LocalGlobalUsage;

  constructor(
    private readonly cfg: Pick<AppConfig, "localDataFile" | "signupMode" | "allowedEmails"> & Partial<Pick<AppConfig, "adminEmails">>,
    db?: LocalDatabase,
    private readonly secureCookies = process.env.NODE_ENV === "production",
  ) {
    this.db = db ?? new LocalDatabase(cfg.localDataFile);
    this.auth = new LocalAuth(this.db);
    this.global = new LocalGlobalUsage(this.db);
  }

  private setSession(jar: CookieJar, token: string) {
    jar.set(LOCAL_SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: this.secureCookies, path: "/", maxAge: 30 * 86400 });
  }

  async signUp(jar: CookieJar, input: { email: string; password: string; displayName: string | null }): Promise<AuthResult> {
    const gate = signupGate(this.cfg, input.email);
    if (gate) return gate;
    try {
      const { token } = await this.auth.signUp(input.email, input.password, input.displayName);
      this.setSession(jar, token);
      return { ok: true };
    } catch (e) {
      if (e instanceof AuthError && e.code === "email_taken") return { ok: false, code: "email_taken" };
      throw e;
    }
  }

  async signIn(jar: CookieJar, input: { email: string; password: string }): Promise<AuthResult> {
    try {
      const { token } = await this.auth.signIn(input.email, input.password);
      this.setSession(jar, token);
      return { ok: true };
    } catch (e) {
      if (e instanceof AuthError) return { ok: false, code: "invalid_credentials" };
      throw e;
    }
  }

  async signOut(jar: CookieJar): Promise<void> {
    await this.auth.signOut(jar.get(LOCAL_SESSION_COOKIE));
    jar.set(LOCAL_SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  }

  async getSession(jar: CookieJar): Promise<Session | null> {
    const user = await this.auth.userFromToken(jar.get(LOCAL_SESSION_COOKIE));
    if (!user) return null;
    return { user, store: new LocalUserStore(this.db, user.id), global: this.global };
  }

  async isAdmin(_jar: CookieJar, session: Session): Promise<boolean> {
    return (this.cfg.adminEmails ?? []).includes(session.user.email.toLowerCase());
  }

  async adminMetricsData(jar: CookieJar, session: Session, since: Date): Promise<MetricsData | null> {
    if (!(await this.isAdmin(jar, session))) return null;
    const d = await this.db.read();
    const s = since.toISOString();
    const msgModel = new Map(d.messages.map((m) => [m.id, m]));
    return {
      users: d.users.map((u) => ({ id: u.id, createdAt: u.createdAt })),
      usage: d.usage
        .filter((u) => u.createdAt >= s)
        .map((u) => ({
          userId: u.userId === "deleted" ? null : u.userId,
          provider: u.provider,
          model: u.model,
          mode: u.mode ?? null,
          status: u.status,
          errorCode: u.errorCode ?? null,
          ttftMs: u.ttftMs ?? null,
          latencyMs: u.latencyMs ?? null,
          inputTokens: u.inputTokens,
          outputTokens: u.outputTokens,
          cost: u.cost,
          createdAt: u.createdAt,
        })),
      feedback: d.feedback
        .filter((f) => f.createdAt >= s)
        .map((f) => ({ rating: f.rating, provider: msgModel.get(f.messageId)?.provider ?? null, model: msgModel.get(f.messageId)?.model ?? null, createdAt: f.createdAt })),
    };
  }
}

/**
 * Supabase Auth + Postgres with RLS. The anon key is public by design; all access control is in RLS.
 * Not yet verified against a live project (DECISIONS P2).
 */
export class SupabaseBackend implements Backend {
  readonly kind = "supabase" as const;
  constructor(private readonly cfg: AppConfig) {
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) throw new Error("Supabase URL and anon key are required for AUDEN_BACKEND=supabase");
  }

  private client(jar: CookieJar) {
    return createServerClient(this.cfg.supabaseUrl!, this.cfg.supabaseAnonKey!, {
      cookies: {
        getAll: () => jar.getAll(),
        setAll: (list) => {
          for (const c of list) {
            try {
              jar.set(c.name, c.value, c.options as CookieOptions);
            } catch {
              // Server Components cannot set cookies; route handlers can. Safe to ignore on read paths.
            }
          }
        },
      },
    });
  }

  async signUp(jar: CookieJar, input: { email: string; password: string; displayName: string | null }): Promise<AuthResult> {
    const gate = signupGate(this.cfg, input.email);
    if (gate) return gate;
    const { data, error } = await this.client(jar).auth.signUp({
      email: input.email,
      password: input.password,
      options: { data: { display_name: input.displayName ?? "" } },
    });
    if (error) {
      const code = /registered|exists/i.test(error.message) ? "email_taken" : /not_invited/i.test(error.message) ? "not_invited" : "auth_error";
      return { ok: false, code, message: error.message };
    }
    return { ok: true, needsEmailConfirmation: !data.session };
  }

  async signIn(jar: CookieJar, input: { email: string; password: string }): Promise<AuthResult> {
    const { error } = await this.client(jar).auth.signInWithPassword(input);
    return error ? { ok: false, code: "invalid_credentials" } : { ok: true };
  }

  async signOut(jar: CookieJar): Promise<void> {
    await this.client(jar).auth.signOut();
  }

  async getSession(jar: CookieJar): Promise<Session | null> {
    const sb = this.client(jar);
    const { data, error } = await sb.auth.getUser();
    if (error || !data.user) return null;
    return {
      user: { id: data.user.id, email: data.user.email ?? "" },
      store: new SupabaseUserStore(sb, data.user.id),
      global: new SupabaseGlobalUsage(sb),
    };
  }

  async isAdmin(jar: CookieJar): Promise<boolean> {
    const { data, error } = await this.client(jar).rpc("is_admin");
    return !error && data === true;
  }

  async adminMetricsData(jar: CookieJar, _session: Session, since: Date): Promise<MetricsData | null> {
    // The database function refuses non-admins, so this cannot be bypassed from the client.
    const { data, error } = await this.client(jar).rpc("admin_metrics_data", { since: since.toISOString() });
    if (error) {
      if (error.code === "42501") return null;
      throw new Error(`Database error: ${error.message}`);
    }
    return data as MetricsData;
  }
}
