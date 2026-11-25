import "server-only";
import { cookies } from "next/headers";
import type { CookieJar, Session } from "./backend";
import { getRuntime } from "./runtime";

/** Read-only session lookup for Server Components (cookie writes are ignored here). */
export async function getServerSession(): Promise<Session | null> {
  const store = await cookies();
  const jar: CookieJar = {
    get: (n) => store.get(n)?.value,
    getAll: () => store.getAll().map((c) => ({ name: c.name, value: c.value })),
    set: () => undefined,
  };
  return getRuntime().backend.getSession(jar);
}
