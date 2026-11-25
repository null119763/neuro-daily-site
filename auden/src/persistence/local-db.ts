import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Conversation, Memory, Message, Profile, Project, UsageEvent } from "@/domain/types";

export interface LocalUser {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: string;
}

export interface LocalSession {
  tokenHash: string;
  userId: string;
  expiresAt: string;
}

export interface LocalData {
  version: 1;
  users: LocalUser[];
  sessions: LocalSession[];
  profiles: Profile[];
  projects: Project[];
  conversations: Conversation[];
  messages: Message[];
  memories: Memory[];
  usage: UsageEvent[];
}

const empty = (): LocalData => ({
  version: 1,
  users: [],
  sessions: [],
  profiles: [],
  projects: [],
  conversations: [],
  messages: [],
  memories: [],
  usage: [],
});

/**
 * Single-process JSON database for development, tests and offline demos.
 * Not for production: no multi-instance safety. Writes are serialized and atomic (tmp file + rename).
 */
export class LocalDatabase {
  private data: LocalData | null = null;
  private loading: Promise<LocalData> | null = null;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string | null) {}

  async read(): Promise<LocalData> {
    if (this.data) return this.data;
    if (!this.loading) {
      this.loading = (async () => {
        let d = empty();
        if (this.filePath) {
          try {
            d = { ...empty(), ...(JSON.parse(await readFile(this.filePath, "utf8")) as LocalData) };
          } catch (err) {
            if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
          }
        }
        this.data = d;
        return d;
      })();
    }
    return this.loading;
  }

  /** Run a mutation and persist the result. Mutations are applied in order. */
  async mutate<T>(fn: (d: LocalData) => T): Promise<T> {
    const d = await this.read();
    const result = fn(d);
    if (this.filePath) {
      const file = this.filePath;
      const snapshot = JSON.stringify(d);
      this.writeChain = this.writeChain.then(async () => {
        await mkdir(path.dirname(file), { recursive: true });
        const tmp = `${file}.${randomUUID()}.tmp`;
        await writeFile(tmp, snapshot, { mode: 0o600 });
        await rename(tmp, file);
      });
      await this.writeChain;
    }
    return result;
  }

  /** Wait for pending writes (tests). */
  async flush(): Promise<void> {
    await this.writeChain;
  }
}
