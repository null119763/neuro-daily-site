import { buildContext } from "@/core/context";
import type { AudenEngine } from "@/core/engine";
import { detectMemoryProposal } from "@/core/memory";
import { checkQuota } from "@/core/quota";
import type { Mode } from "@/core/types";
import type { Attachment, Conversation, Memory, Message } from "@/domain/types";
import { chatRequestSchema, deriveTitle } from "@/domain/validation";
import type { Session } from "./backend";
import type { AppConfig } from "./config";

export type ChatStreamEvent =
  | { type: "start"; conversation: Conversation; userMessage: Message; memoryProposal: Memory | null; attachments: Attachment[] }
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
    const tooLong = parsed.error.issues.some((i) => i.code === "too_big" && i.path[0] === "message");
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

  // Regenerate: reuse the last user message and drop the assistant answers that followed it.
  let regen: { userMessage: Message; before: Message[]; drop: Message[] } | null = null;
  if (req.regenerate && conversation) {
    const recent = await store.listMessages(conversation.id, { limit: HISTORY_LIMIT + 10 });
    let i = recent.length - 1;
    while (i >= 0 && recent[i]!.role === "assistant") i--;
    if (i < 0) return { ok: false, status: 400, code: "nothing_to_regenerate", message: "No user message to answer" };
    regen = { userMessage: recent[i]!, before: recent.slice(0, i), drop: recent.slice(i + 1) };
  }
  const userText = regen ? regen.userMessage.content : req.message!;

  // Attachments must be the user's own uploads that were not sent yet.
  const attachmentIds = [...new Set(req.attachmentIds ?? [])];
  if (attachmentIds.length) {
    const found = await store.getAttachments(attachmentIds);
    if (found.length !== attachmentIds.length) return { ok: false, status: 404, code: "attachment_not_found", message: "Attachment not found" };
    if (found.some((a) => a.messageId)) return { ok: false, status: 409, code: "attachment_already_sent", message: "Attachment already sent" };
  }

  const run = async function* (signal: AbortSignal): AsyncGenerator<ChatStreamEvent> {
    const mode: Mode = req.mode ?? conversation?.mode ?? profile.defaultMode;
    if (!conversation) {
      conversation = await store.createConversation({ title: deriveTitle(userText), projectId: req.projectId ?? null, mode });
    } else if (conversation.mode !== mode) {
      conversation = (await store.updateConversation(conversation.id, { mode })) ?? conversation;
    }
    const conv = conversation;

    const [history, project, memories] = await Promise.all([
      regen ? Promise.resolve(regen.before.slice(-HISTORY_LIMIT)) : store.listMessages(conv.id, { limit: HISTORY_LIMIT }),
      conv.projectId ? store.getProject(conv.projectId) : Promise.resolve(null),
      profile.memoryEnabled ? store.listMemories({ consent: true, projectId: conv.projectId }) : Promise.resolve([]),
    ]);

    let userMessage: Message;
    if (regen) {
      userMessage = regen.userMessage;
    } else {
      userMessage = (await store.addMessage(conv.id, { role: "user", content: userText }))!;
    }
    if (!regen && attachmentIds.length) await store.linkAttachments(attachmentIds, conv.id, userMessage.id);
    const documents = await store.listConversationAttachments(conv.id);
    let memoryProposal: Memory | null = null;
    const fact = profile.memoryEnabled && !regen ? detectMemoryProposal(userText) : null;
    if (fact) {
      memoryProposal = await store.createMemory({ content: fact, projectId: conv.projectId, source: "chat", sourceConversationId: conv.id, consent: false });
    }
    const sentWith = documents.filter((d) => d.messageId === userMessage.id).map(({ content, ...meta }) => (void content, meta));
    yield { type: "start", conversation: conv, userMessage, memoryProposal, attachments: sentWith };

    const messages = buildContext({
      locale: profile.locale,
      displayName: profile.displayName,
      customInstructions: profile.customInstructions,
      project: project ? { title: project.title, instructions: project.instructions } : null,
      memories,
      documents: documents.map((d) => ({ name: d.name, content: d.content })),
      history: history.filter((m) => m.status === "complete").map((m) => ({ role: m.role, content: m.content })),
      userMessage: userText,
      maxInputTokens: cfg.maxContextTokens,
    });

    // The previous answer is replaced only once a new one (complete or partial) is saved.
    const dropReplaced = async () => {
      if (regen) for (const m of regen.drop) await store.deleteMessage(m.id);
    };
    let routed: { provider: string; model: string } | null = null;
    for await (const ev of engine.run({ mode, messages, signal, maxOutputTokens: cfg.maxOutputTokens })) {
      if (ev.type === "route") {
        routed = { provider: ev.provider, model: ev.model };
        yield { type: "route", provider: ev.provider, model: ev.model };
      } else if (ev.type === "delta") {
        yield { type: "delta", text: ev.text };
      } else if (ev.type === "done") {
        await dropReplaced();
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
          await dropReplaced();
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
