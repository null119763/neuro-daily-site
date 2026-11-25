import "server-only";
import { cookies } from "next/headers";
import type { CookieJar, Session } from "./backend";
import { getRuntime } from "./runtime";

async function serverJar(): Promise<CookieJar> {
  const store = await cookies();
  return {
    get: (n) => store.get(n)?.value,
    getAll: () => store.getAll().map((c) => ({ name: c.name, value: c.value })),
    set: () => undefined,
  };
}

/** Read-only session lookup for Server Components (cookie writes are ignored here). */
export async function getServerSession(): Promise<Session | null> {
  return getRuntime().backend.getSession(await serverJar());
}

export async function getServerAdmin(session: Session): Promise<boolean> {
  return getRuntime().backend.isAdmin(await serverJar(), session).catch(() => false);
}
