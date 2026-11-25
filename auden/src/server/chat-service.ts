import { buildContext } from "@/core/context";
import type { AudenEngine } from "@/core/engine";
import { detectMemoryProposal } from "@/core/memory";
import { checkQuota } from "@/core/quota";
import type { Mode } from "@/core/types";
import type { Conversation, Memory, Message } from "@/domain/types";
import { chatRequestSchema, deriveTitle } from "@/domain/validation";
import type { Session } from "./backend";
import type { AppConfig } from "./config";

export type ChatStreamEvent =
  | { type: "start"; conversation: Conversation; userMessage: Message; memoryProposal: Memory | null }
  | { type: "route"; provider: string; model: string }
  | { type: "delta"; text: string }
  | { type: "done"; message: Message }
  | { type: "error"; code: string; message: string; saved: Message | null };

export type ChatPrecheck =
  | { ok: true; run: (signal: AbortSignal) => AsyncGenerator<ChatStreamEvent> }
  | { ok: false; status: number; code: string; message: string; retryAfterSec?: number };

const HISTORY_LIMIT = 40;

/**
 * Validates, checks quotas and ownership synchronously (so errors become proper HTTP statuses),
 * then returns a generator that streams the answer and persists everything.
 */
export async function prepareChat(session: Session, engine: AudenEngine, cfg: AppConfig, body: unknown): Promise<ChatPrecheck> {
  const parsed = chatRequestSchema(cfg.maxInputChars).safeParse(body);
  if (!parsed.success) {
    const tooLong = parsed.error.issues.some((i) => i.code === "too_big");
    return { ok: false, status: tooLong ? 413 : 400, code: tooLong ? "input_too_long" : "bad_request", message: "Invalid chat request" };
  }
  const req = parsed.data;
  const { store } = session;

  const quota = await checkQuota(
    {
      countUserRequests: (_u, since) => store.countRequests(since),
      countGlobalRequests: (since) => session.global.countRequests(since, cfg.limits.userPerDay),
      sumGlobalCost: (since) => session.global.sumCost(since),
    },
    session.user.id,
    cfg.limits,
  );
  if (!quota.ok) return { ok: false, status: 429, code: quota.code, message: "Limit reached", retryAfterSec: quota.retryAfterSec };

  const profile = await store.getProfile();
  let conversation: Conversation | null = null;
  if (req.conversationId) {
    conversation = await store.getConversation(req.conversationId);
    if (!conversation) return { ok: false, status: 404, code: "not_found", message: "Conversation not found" };
  } else if (req.projectId && !(await store.getProject(req.projectId))) {
    return { ok: false, status: 404, code: "not_found", message: "Project not found" };
  }

  const run = async function* (signal: AbortSignal): AsyncGenerator<ChatStreamEvent> {
    const mode: Mode = req.mode ?? conversation?.mode ?? profile.defaultMode;
    if (!conversation) {
      conversation = await store.createConversation({ title: deriveTitle(req.message), projectId: req.projectId ?? null, mode });
    } else if (conversation.mode !== mode) {
      conversation = (await store.updateConversation(conversation.id, { mode })) ?? conversation;
    }
    const conv = conversation;

    const [history, project, memories] = await Promise.all([
      store.listMessages(conv.id, { limit: HISTORY_LIMIT }),
      conv.projectId ? store.getProject(conv.projectId) : Promise.resolve(null),
      profile.memoryEnabled ? store.listMemories({ consent: true, projectId: conv.projectId }) : Promise.resolve([]),
    ]);

    const userMessage = (await store.addMessage(conv.id, { role: "user", content: req.message }))!;
    let memoryProposal: Memory | null = null;
    const fact = profile.memoryEnabled ? detectMemoryProposal(req.message) : null;
    if (fact) {
      memoryProposal = await store.createMemory({ content: fact, projectId: conv.projectId, source: "chat", sourceConversationId: conv.id, consent: false });
    }
    yield { type: "start", conversation: conv, userMessage, memoryProposal };

    const messages = buildContext({
      locale: profile.locale,
      displayName: profile.displayName,
      customInstructions: profile.customInstructions,
      project: project ? { title: project.title, instructions: project.instructions } : null,
      memories,
      history: history.filter((m) => m.status === "complete").map((m) => ({ role: m.role, content: m.content })),
      userMessage: req.message,
      maxInputTokens: cfg.maxContextTokens,
    });

    let routed: { provider: string; model: string } | null = null;
    for await (const ev of engine.run({ mode, messages, signal, maxOutputTokens: cfg.maxOutputTokens })) {
      if (ev.type === "route") {
        routed = { provider: ev.provider, model: ev.model };
        yield { type: "route", provider: ev.provider, model: ev.model };
      } else if (ev.type === "delta") {
        yield { type: "delta", text: ev.text };
      } else if (ev.type === "done") {
        const message = (await store.addMessage(conv.id, {
          role: "assistant",
          content: ev.text,
          provider: ev.provider,
          model: ev.model,
          status: "complete",
          inputTokens: ev.inputTokens,
          outputTokens: ev.outputTokens,
        }))!;
        await store.recordUsage({ provider: ev.provider, model: ev.model, inputTokens: ev.inputTokens, outputTokens: ev.outputTokens, cost: ev.costUsd, status: "complete" });
        yield { type: "done", message };
      } else {
        const status = ev.code === "cancelled" ? "cancelled" : "error";
        let saved: Message | null = null;
        if (ev.partialText) {
          saved = await store.addMessage(conv.id, {
            role: "assistant",
            content: ev.partialText,
            provider: ev.provider ?? null,
            model: ev.model ?? null,
            status,
            inputTokens: ev.inputTokens,
            outputTokens: ev.outputTokens,
          });
        }
        // Count every request that reached a provider, so failures cannot be used to bypass quotas.
        if (routed) {
          await store.recordUsage({ provider: routed.provider, model: routed.model, inputTokens: ev.inputTokens, outputTokens: ev.outputTokens, cost: 0, status });
        }
        yield { type: "error", code: ev.code, message: ev.message, saved };
      }
    }
  };

  return { ok: true, run };
}
