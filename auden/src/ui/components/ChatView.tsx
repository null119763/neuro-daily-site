"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUp, BookmarkPlus, Check, Copy, Ellipsis, FileText, ImageIcon, LoaderCircle, Mic, Paperclip, RotateCcw, Square, ThumbsDown, ThumbsUp, X } from "lucide-react";
import type { Mode } from "@/core/types";
import type { Attachment, Conversation, Memory, Message } from "@/domain/types";
import { useApp } from "../app-context";
import { api, ApiError, streamChat } from "../api-client";
import { errorText } from "../i18n";
import { modelLabel, shortTime } from "../format";
import { Markdown } from "./Markdown";
import { LogoMark } from "./Logo";
import { MenuButton } from "./AppShell";

type UIMessage = Pick<Message, "id" | "role" | "content" | "provider" | "model" | "status" | "createdAt"> & {
  streaming?: boolean;
  errorCode?: string;
  proposal?: Memory | null;
  attachments?: Attachment[];
  rating?: 1 | -1 | null;
};

const MODES: Mode[] = ["air", "core", "prime"];
const MAX_FILES = 3;
const MAX_BYTES = 4 * 1024 * 1024;
const ACCEPT = ".txt,.md,.markdown,.csv,.tsv,.log,.pdf,text/plain,text/markdown,text/csv,application/pdf";

type PendingFile = { key: string; name: string; size: number; status: "uploading" | "ready"; attachment?: Attachment };

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function AttachmentChips({ items, onRemove, removeLabel }: { items: { key: string; name: string; size: number; loading?: boolean }[]; onRemove?: (key: string) => void; removeLabel?: string }) {
  if (!items.length) return null;
  return (
    <div className="chips" data-testid="attachment-chips">
      {items.map((a) => (
        <span key={a.key} className="chip" title={a.name}>
          {a.loading ? <LoaderCircle size={14} className="spin" aria-hidden /> : <FileText size={14} aria-hidden />}
          <span className="chip-name">{a.name}</span>
          <span className="chip-size">{formatSize(a.size)}</span>
          {onRemove && (
            <button type="button" className="chip-x" aria-label={`${removeLabel}: ${a.name}`} onClick={() => onRemove(a.key)} disabled={a.loading}>
              <X size={13} />
            </button>
          )}
        </span>
      ))}
    </div>
  );
}

export function ChatView({ conversationId, projectId, intro }: { conversationId: string | null; projectId?: string | null; intro?: React.ReactNode }) {
  const app = useApp();
  const { t, locale, profile } = app;
  const router = useRouter();
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [loading, setLoading] = useState(Boolean(conversationId));
  const [notFound, setNotFound] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>(profile.defaultMode);
  const [menuOpen, setMenuOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const stickToBottom = useRef(true);

  // Load existing conversation
  useEffect(() => {
    if (!conversationId) return;
    let cancelled = false;
    api<Conversation & { messages: Message[]; attachments: Attachment[]; feedback: Record<string, 1 | -1> }>(`conversations/${conversationId}`)
      .then((c) => {
        if (cancelled) return;
        setConversation(c);
        setMode(c.mode);
        setMessages(c.messages.map((m) => ({ ...m, attachments: c.attachments.filter((a) => a.messageId === m.id), rating: c.feedback[m.id] ?? null })));
      })
      .catch((e) => {
        if (!cancelled && e instanceof ApiError && e.status === 404) setNotFound(true);
        else if (!cancelled) setBanner(errorText(locale, (e as ApiError).code));
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [conversationId, locale]);

  // Abort the stream when leaving the page.
  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const autosize = () => {
    const el = textRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  };

  /**
   * Streams one answer. For a new message `tmpUser` is shown optimistically; for regenerate the previous
   * answers (`replaced`) are hidden and restored if no new answer could be produced.
   */
  const runStream = useCallback(
    async (body: Record<string, unknown>, opts: { tmpUser?: UIMessage; replaced?: UIMessage[]; onRejected?: () => void }) => {
      setBanner(null);
      setBusy(true);
      stickToBottom.current = true;
      const replacedIds = new Set((opts.replaced ?? []).map((m) => m.id));
      const tmpAi: UIMessage = { id: `tmp-a-${Date.now()}`, role: "assistant", content: "", provider: null, model: null, status: "complete", createdAt: new Date().toISOString(), streaming: true };
      setMessages((list) => [...list.filter((m) => !replacedIds.has(m.id)), ...(opts.tmpUser ? [opts.tmpUser] : []), tmpAi]);

      const restoreReplaced = () => setMessages((list) => [...list.filter((m) => m.id !== tmpAi.id), ...(opts.replaced ?? [])]);
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      const patchAi = (fn: (m: UIMessage) => UIMessage) => setMessages((list) => list.map((m) => (m.id === tmpAi.id ? fn(m) : m)));
      let gotTerminal = false;
      try {
        for await (const ev of streamChat(body, ctrl.signal)) {
          if (ev.type === "start") {
            setConversation(ev.conversation);
            app.upsertConversation(ev.conversation);
            if (opts.tmpUser) {
              const tmpId = opts.tmpUser.id;
              setMessages((list) => list.map((m) => (m.id === tmpId ? { ...ev.userMessage, proposal: ev.memoryProposal, attachments: ev.attachments } : m)));
            }
            if (!conversationId) window.history.replaceState(null, "", `/c/${ev.conversation.id}`);
          } else if (ev.type === "route") {
            patchAi((m) => ({ ...m, provider: ev.provider, model: ev.model }));
          } else if (ev.type === "delta") {
            patchAi((m) => ({ ...m, content: m.content + ev.text }));
          } else if (ev.type === "done") {
            gotTerminal = true;
            setMessages((list) => list.map((m) => (m.id === tmpAi.id ? ev.message : m)));
          } else if (ev.type === "error") {
            gotTerminal = true;
            if (ev.saved) {
              const saved = ev.saved;
              setMessages((list) => list.map((m) => (m.id === tmpAi.id ? { ...saved, errorCode: ev.code } : m)));
            } else {
              restoreReplaced();
              if (ev.code !== "cancelled") setBanner(errorText(locale, ev.code));
            }
          }
        }
        if (!gotTerminal) {
          // Stream ended without a final event: user pressed stop or the connection dropped.
          patchAi((m) => ({ ...m, streaming: false, status: "cancelled", errorCode: ctrl.signal.aborted ? "cancelled" : "network" }));
          setMessages((list) => {
            const ai = list.find((m) => m.id === tmpAi.id);
            return ai && !ai.content ? [...list.filter((m) => m.id !== tmpAi.id), ...(opts.replaced ?? [])] : list;
          });
        }
      } catch (e) {
        const err = e as ApiError;
        if (err.code === "unauthorized") {
          router.replace("/login");
          return;
        }
        restoreReplaced();
        if (opts.tmpUser) {
          // Rejected before streaming: remove the optimistic message and give the text back.
          const tmpId = opts.tmpUser.id;
          setMessages((list) => list.filter((m) => m.id !== tmpId));
          setInput(opts.tmpUser.content);
        }
        opts.onRejected?.();
        setBanner(errorText(locale, err.code));
      } finally {
        abortRef.current = null;
        setBusy(false);
        app.refreshConversations().catch(() => undefined);
      }
    },
    [conversationId, locale, app, router],
  );

  const [pending, setPending] = useState<PendingFile[]>([]);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const uploading = pending.some((p) => p.status === "uploading");

  const addFiles = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files);
      const free = MAX_FILES - pending.length;
      if (list.length > free) setBanner(errorText(locale, "too_many_files"));
      for (const file of list.slice(0, Math.max(free, 0))) {
        if (file.size > MAX_BYTES) {
          setBanner(errorText(locale, "too_large"));
          continue;
        }
        const key = `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`;
        setPending((p) => [...p, { key, name: file.name, size: file.size, status: "uploading" }]);
        try {
          const form = new FormData();
          form.append("file", file);
          const res = await fetch("/api/attachments", { method: "POST", body: form, credentials: "same-origin" });
          const data = (await res.json()) as Attachment & { error?: { code: string } };
          if (!res.ok) throw new ApiError(res.status, data.error?.code ?? "generic");
          setPending((p) => p.map((x) => (x.key === key ? { ...x, status: "ready", attachment: data } : x)));
        } catch (e) {
          setPending((p) => p.filter((x) => x.key !== key));
          setBanner(errorText(locale, e instanceof ApiError ? e.code : "network"));
        }
      }
    },
    [pending.length, locale],
  );

  const removePending = useCallback((key: string) => {
    setPending((p) => {
      const item = p.find((x) => x.key === key);
      if (item?.attachment) void api(`attachments/${item.attachment.id}`, { method: "DELETE" }).catch(() => undefined);
      return p.filter((x) => x.key !== key);
    });
  }, []);

  const send = useCallback(
    async (text: string) => {
      const message = text.trim();
      if (!message || busy || uploading) return;
      setInput("");
      requestAnimationFrame(autosize);
      const sending = pending.filter((p) => p.attachment);
      setPending([]);
      const attachments = sending.map((p) => p.attachment!);
      const tmpUser: UIMessage = { id: `tmp-u-${Date.now()}`, role: "user", content: message, provider: null, model: null, status: "complete", createdAt: new Date().toISOString(), attachments };
      await runStream(
        {
          conversationId: conversation?.id ?? null,
          projectId: conversation ? undefined : projectId ?? null,
          message,
          mode,
          ...(attachments.length ? { attachmentIds: attachments.map((a) => a.id) } : {}),
        },
        { tmpUser, onRejected: () => setPending(sending) },
      );
    },
    [busy, uploading, pending, conversation, projectId, mode, runStream],
  );

  /** New answer for the last user message, replacing the answer(s) after it — no duplicate user message. */
  const regenerate = useCallback(async () => {
    if (busy || !conversation) return;
    let i = messages.length - 1;
    while (i >= 0 && messages[i]!.role === "assistant") i--;
    if (i < 0 || messages[i]!.id.startsWith("tmp")) return;
    await runStream({ conversationId: conversation.id, regenerate: true, mode }, { replaced: messages.slice(i + 1) });
  }, [busy, conversation, messages, mode, runStream]);

  async function rate(id: string, value: 1 | -1) {
    const current = messages.find((m) => m.id === id)?.rating ?? null;
    const next = current === value ? null : value;
    setMessages((list) => list.map((m) => (m.id === id ? { ...m, rating: next } : m)));
    try {
      await api(`messages/${id}/feedback`, { method: "PUT", body: { rating: next } });
    } catch (e) {
      setMessages((list) => list.map((m) => (m.id === id ? { ...m, rating: current } : m)));
      setBanner(errorText(locale, (e as ApiError).code));
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    const coarse = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
    if (e.key === "Enter" && !e.shiftKey && !coarse && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send(input);
    }
  }

  async function resolveProposal(msgId: string, proposal: Memory, accept: boolean) {
    try {
      if (accept) await api(`memory/${proposal.id}`, { method: "PATCH", body: { consent: true } });
      else await api(`memory/${proposal.id}`, { method: "DELETE" });
      setMessages((list) => list.map((m) => (m.id === msgId ? { ...m, proposal: accept ? { ...proposal, consent: true } : null } : m)));
    } catch (e) {
      setBanner(errorText(locale, (e as ApiError).code));
    }
  }

  async function saveToMemory(msg: UIMessage) {
    try {
      const m = await api<Memory>("memory", { method: "POST", body: { content: msg.content.slice(0, 500), projectId: conversation?.projectId ?? null } });
      setMessages((list) => list.map((x) => (x.id === msg.id ? { ...x, proposal: m } : x)));
    } catch (e) {
      setBanner(errorText(locale, (e as ApiError).code));
    }
  }

  async function patchConversation(patch: Partial<Conversation>) {
    if (!conversation) return;
    try {
      const c = await api<Conversation>(`conversations/${conversation.id}`, { method: "PATCH", body: patch });
      setConversation(c);
      app.upsertConversation(c);
    } catch (e) {
      setBanner(errorText(locale, (e as ApiError).code));
    }
  }

  async function changeMode(m: Mode) {
    setMode(m);
    if (conversation) await patchConversation({ mode: m });
  }

  async function rename() {
    setMenuOpen(false);
    const title = window.prompt(t("chat.rename"), conversation?.title ?? "");
    if (title && title.trim()) await patchConversation({ title: title.trim().slice(0, 120) });
  }

  async function remove() {
    setMenuOpen(false);
    if (!conversation || !window.confirm(t("chat.deleteConfirm"))) return;
    try {
      await api(`conversations/${conversation.id}`, { method: "DELETE" });
      app.removeConversation(conversation.id);
      router.replace("/");
    } catch (e) {
      setBanner(errorText(locale, (e as ApiError).code));
    }
  }

  const projectTitle = conversation?.projectId ? app.projects.find((p) => p.id === conversation.projectId)?.title : app.projects.find((p) => p.id === projectId)?.title;
  const lastAi = [...messages].reverse().find((m) => m.role === "assistant");
  const showMock = messages.some((m) => m.provider === "mock");
  const lastMsg = messages[messages.length - 1];
  // A saved user message with no answer after it (the answer failed): offer to generate one.
  const canRegenerate = Boolean(conversation && lastMsg?.role === "user" && !lastMsg.id.startsWith("tmp"));

  if (notFound) {
    return (
      <>
        <header className="topbar"><MenuButton /></header>
        <div className="page"><p className="empty">{t("chat.notFound")}</p></div>
      </>
    );
  }

  return (
    <>
      <header className="topbar">
        <MenuButton />
        <LogoMark size={24} />
        <div className="topbar-title">
          <div className="t" data-testid="chat-title">{conversation?.title ?? t("nav.newChat")}</div>
          <div className="s">{[projectTitle, mode[0]!.toUpperCase() + mode.slice(1)].filter(Boolean).join(" · ")}</div>
        </div>
        {conversation && (
          <div style={{ position: "relative" }}>
            <button className="icon-btn" aria-label={t("common.more")} aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((v) => !v)}>
              <Ellipsis size={20} />
            </button>
            {menuOpen && (
              <div className="menu card" role="menu" onKeyDown={(e) => e.key === "Escape" && setMenuOpen(false)}>
                <button role="menuitem" onClick={rename}>{t("chat.rename")}</button>
                <button role="menuitem" onClick={() => { setMenuOpen(false); void patchConversation({ favorite: !conversation.favorite }); }}>
                  {conversation.favorite ? t("chat.unfavorite") : t("chat.favorite")}
                </button>
                {app.projects.length > 0 && (
                  <label style={{ display: "grid", gap: 4, padding: "6px 12px", fontSize: 13 }}>
                    <span className="muted">{t("chat.moveToProject")}</span>
                    <select className="select" style={{ minHeight: 36 }} value={conversation.projectId ?? ""} onChange={(e) => { setMenuOpen(false); void patchConversation({ projectId: e.target.value || null }); }}>
                      <option value="">{t("chat.noProject")}</option>
                      {app.projects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
                    </select>
                  </label>
                )}
                <button role="menuitem" className="danger" onClick={remove}>{t("chat.delete")}</button>
              </div>
            )}
          </div>
        )}
      </header>

      <div
        className="chat-scroll"
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        <div className="chat-inner" aria-live="polite" aria-busy={busy}>
          {loading && <p className="empty">{t("chat.loading")}</p>}
          {!loading && messages.length === 0 && (intro ?? <p className="empty">{t("chat.empty")}</p>)}
          {showMock && <div className="notice small" role="note">{t("settings.mockWarning")}</div>}
          {messages.map((m) =>
            m.role === "user" ? (
              <div key={m.id} className="msg-user" data-testid="msg-user">
                <AttachmentChips items={(m.attachments ?? []).map((a) => ({ key: a.id, name: a.name, size: a.size }))} />
                <div className="bubble">{m.content}</div>
                <div className="msg-meta inline" style={{ justifyContent: "flex-end" }}>
                  {!m.id.startsWith("tmp") && !m.proposal && (
                    <button className="icon-btn" style={{ width: 28, height: 28 }} title={t("chat.toMemory")} aria-label={t("chat.toMemory")} onClick={() => saveToMemory(m)}>
                      <BookmarkPlus size={15} />
                    </button>
                  )}
                  <span>{shortTime(m.createdAt, locale)}</span>
                </div>
                {m.proposal && (
                  <div className="memory-proposal" style={{ marginTop: 8 }} data-testid="memory-proposal">
                    {m.proposal.consent ? (
                      <span><Check size={14} style={{ verticalAlign: -2 }} /> {t("chat.memorySaved")}: «{m.proposal.content}»</span>
                    ) : (
                      <>
                        <span style={{ flex: 1 }}>{t("chat.memoryProposal")} «{m.proposal.content}»</span>
                        <button className="btn btn-primary" style={{ minHeight: 32, padding: "4px 12px" }} onClick={() => resolveProposal(m.id, m.proposal!, true)}>{t("chat.memoryConfirm")}</button>
                        <button className="btn" style={{ minHeight: 32, padding: "4px 12px" }} onClick={() => resolveProposal(m.id, m.proposal!, false)}>{t("chat.memoryDismiss")}</button>
                      </>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <AssistantMessage key={m.id} m={m} isLast={m.id === lastAi?.id} onRetry={!busy ? () => void regenerate() : undefined} onRate={(v) => void rate(m.id, v)} />
            ),
          )}
          {banner && (
            <div className="alert" role="alert">
              {banner}{" "}
              {canRegenerate && !busy && (
                <button className="btn btn-ghost" style={{ minHeight: 28, padding: "2px 8px" }} onClick={() => void regenerate()}>{t("chat.retry")}</button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="composer-wrap">
        <div className="composer-box">
        <AttachmentChips
          items={pending.map((p) => ({ key: p.key, name: p.name, size: p.size, loading: p.status === "uploading" }))}
          onRemove={removePending}
          removeLabel={t("chat.removeAttachment")}
        />
        <form
          className={`composer${dragging ? " dragging" : ""}`}
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes("Files")) {
              e.preventDefault();
              setDragging(true);
            }
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            if (!e.dataTransfer.files.length) return;
            e.preventDefault();
            setDragging(false);
            void addFiles(e.dataTransfer.files);
          }}
        >
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPT}
            multiple
            hidden
            data-testid="file-input"
            onChange={(e) => {
              if (e.target.files) void addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            className="icon-btn"
            onClick={() => fileRef.current?.click()}
            disabled={busy || pending.length >= MAX_FILES}
            title={t("chat.attachHint")}
            aria-label={t("chat.attach")}
          >
            <Paperclip size={19} />
          </button>
          <label className="sr-only" htmlFor="composer-input">{t("chat.placeholder")}</label>
          <textarea
            id="composer-input"
            ref={textRef}
            rows={1}
            value={input}
            placeholder={t("chat.placeholder")}
            onChange={(e) => {
              setInput(e.target.value);
              autosize();
            }}
            onKeyDown={onKeyDown}
            maxLength={8000}
            data-testid="composer"
          />
          <button type="button" className="icon-btn hide-narrow" disabled title={`${t("soon")}: ${t("soon.image")}`} aria-label={`${t("soon")}: ${t("soon.image")}`}>
            <ImageIcon size={19} />
          </button>
          <button type="button" className="icon-btn" disabled title={`${t("soon")}: ${t("soon.voice")}`} aria-label={`${t("soon")}: ${t("soon.voice")}`}>
            <Mic size={19} />
          </button>
          {busy ? (
            <button type="button" className="send-btn" onClick={stop} aria-label={t("chat.stop")} data-testid="stop">
              <Square size={14} fill="currentColor" />
            </button>
          ) : (
            <button type="submit" className="send-btn" disabled={!input.trim() || uploading} aria-label={t("chat.send")} data-testid="send">
              <ArrowUp size={20} />
            </button>
          )}
        </form>
        </div>
        <div className="composer-foot">
          <label className="inline">
            <span>{t("chat.mode")}</span>
            <select className="mode-select" value={mode} onChange={(e) => changeMode(e.target.value as Mode)} disabled={busy} data-testid="mode-select">
              {MODES.map((m) => <option key={m} value={m}>{m[0]!.toUpperCase() + m.slice(1)}</option>)}
            </select>
          </label>
          <span>{t("chat.disclaimer")}</span>
        </div>
      </div>
    </>
  );
}

function AssistantMessage({ m, isLast, onRetry, onRate }: { m: UIMessage; isLast: boolean; onRetry?: () => void; onRate: (v: 1 | -1) => void }) {
  const { t, locale } = useApp();
  const [copied, setCopied] = useState(false);
  const label = modelLabel(m.provider, m.model);
  const interrupted = m.status !== "complete" || m.errorCode;
  return (
    <article className="msg-ai" data-testid="msg-ai">
      <div className="avatar"><LogoMark size={22} /></div>
      <div className="body">
        {m.streaming && !m.content ? (
          <div className="thinking" aria-label={t("common.loading")}><i /><i /><i /></div>
        ) : (
          <div className={m.streaming ? "cursor" : undefined}>
            <Markdown text={m.content} />
          </div>
        )}
        {interrupted && !m.streaming && (
          <div className="msg-status small muted">{m.status === "cancelled" || m.errorCode === "cancelled" ? t("chat.cancelled") : `${t("chat.partial")} ${errorText(locale, m.errorCode)}`}</div>
        )}
        {!m.streaming && (
          <div className="meta-row">
            <button
              className="icon-btn"
              style={{ width: 32, height: 32 }}
              aria-label={copied ? t("chat.copied") : t("chat.copy")}
              title={copied ? t("chat.copied") : t("chat.copy")}
              onClick={() => {
                void navigator.clipboard?.writeText(m.content).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                });
              }}
            >
              {copied ? <Check size={16} /> : <Copy size={16} />}
            </button>
            {!m.id.startsWith("tmp") && (
              <>
                <button className={`icon-btn${m.rating === 1 ? " active" : ""}`} style={{ width: 32, height: 32 }} aria-label={t("chat.good")} title={t("chat.good")} aria-pressed={m.rating === 1} onClick={() => onRate(1)}>
                  <ThumbsUp size={16} />
                </button>
                <button className={`icon-btn${m.rating === -1 ? " active" : ""}`} style={{ width: 32, height: 32 }} aria-label={t("chat.bad")} title={t("chat.bad")} aria-pressed={m.rating === -1} onClick={() => onRate(-1)}>
                  <ThumbsDown size={16} />
                </button>
              </>
            )}
            {isLast && onRetry && (
              <button className="icon-btn" style={{ width: 32, height: 32 }} aria-label={t("chat.regenerate")} title={t("chat.regenerate")} onClick={onRetry}>
                <RotateCcw size={16} />
              </button>
            )}
            <span className="model-label" data-testid="model-label">{label}{label ? " · " : ""}{shortTime(m.createdAt, locale)}</span>
          </div>
        )}
        {m.streaming && label && <div className="meta-row"><span className="model-label">{label}</span></div>}
      </div>
    </article>
  );
}
