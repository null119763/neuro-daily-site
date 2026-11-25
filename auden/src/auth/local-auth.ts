import { createHash, randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { AuthUser } from "@/domain/types";
import type { LocalDatabase } from "@/persistence/local-db";
import { defaultProfile } from "@/persistence/local-store";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, keylen: number) => Promise<Buffer>;
const SESSION_DAYS = 30;

export class AuthError extends Error {
  constructor(
    readonly code: "email_taken" | "invalid_credentials" | "signups_closed" | "weak_password",
    message: string,
  ) {
    super(message);
  }
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize("NFKC"), salt, 64);
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, saltB64, keyB64] = stored.split("$");
  if (alg !== "scrypt" || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, "base64");
  const key = await scrypt(password.normalize("NFKC"), Buffer.from(saltB64, "base64"), expected.length);
  return timingSafeEqual(key, expected);
}

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** Email + password auth for the local backend. Session tokens are random; only their SHA-256 is stored. */
export class LocalAuth {
  constructor(private readonly db: LocalDatabase) {}

  async signUp(email: string, password: string, displayName: string | null): Promise<{ user: AuthUser; token: string }> {
    const passwordHash = await hashPassword(password);
    const user = await this.db.mutate((d) => {
      if (d.users.some((u) => u.email === email)) throw new AuthError("email_taken", "Email already registered");
      const u = { id: randomUUID(), email, passwordHash, createdAt: new Date().toISOString() };
      d.users.push(u);
      d.profiles.push(defaultProfile(u.id, email, displayName));
      return u;
    });
    const token = await this.createSession(user.id);
    return { user: { id: user.id, email: user.email }, token };
  }

  async signIn(email: string, password: string): Promise<{ user: AuthUser; token: string }> {
    const d = await this.db.read();
    const u = d.users.find((x) => x.email === email);
    // Always run a hash to keep timing similar for unknown emails.
    const ok = await verifyPassword(password, u?.passwordHash ?? "scrypt$AAAAAAAAAAAAAAAAAAAAAA==$" + "A".repeat(86) + "==");
    if (!u || !ok) throw new AuthError("invalid_credentials", "Invalid email or password");
    return { user: { id: u.id, email: u.email }, token: await this.createSession(u.id) };
  }

  private async createSession(userId: string): Promise<string> {
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString();
    await this.db.mutate((d) => {
      const now = new Date().toISOString();
      d.sessions = d.sessions.filter((s) => s.expiresAt > now);
      d.sessions.push({ tokenHash: hashToken(token), userId, expiresAt });
    });
    return token;
  }

  async userFromToken(token: string | undefined): Promise<AuthUser | null> {
    if (!token) return null;
    const d = await this.db.read();
    const s = d.sessions.find((x) => x.tokenHash === hashToken(token));
    if (!s || s.expiresAt <= new Date().toISOString()) return null;
    const u = d.users.find((x) => x.id === s.userId);
    return u ? { id: u.id, email: u.email } : null;
  }

  async signOut(token: string | undefined): Promise<void> {
    if (!token) return;
    const h = hashToken(token);
    await this.db.mutate((d) => {
      d.sessions = d.sessions.filter((s) => s.tokenHash !== h);
    });
  }
}
