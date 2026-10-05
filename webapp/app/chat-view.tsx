"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BotProfile } from "@/lib/bot";
import type { ChatMessage, ChatReply } from "@/lib/chat";
import { sendJson } from "@/lib/client";
import { clock } from "@/lib/format";
import AppChrome from "./app-chrome";
import CopyButton from "./copy-button";
import { usePoll } from "./hooks";
import { buttonClass, Spinner } from "./ui";

const POLL_MS = 5000;
const MAX_CHARS = 2000;

const COMMANDS: { cmd: string; hint: string }[] = [
  { cmd: "/ask ", hint: "give it a question to pursue" },
  { cmd: "/interest ", hint: "nudge an interest: topic [delta]" },
  { cmd: "/pause", hint: "hold the loop" },
  { cmd: "/resume", hint: "release it" },
  { cmd: "/help", hint: "what it understands" },
];

function roleLabel(m: ChatMessage, bot: BotProfile): string {
  if (m.role === "owner") return "You";
  if (m.role === "system") return "Command";
  return bot.name;
}

export default function ChatView({ bot }: { bot: BotProfile }) {
  const chat = usePoll<ChatMessage[]>(`bots/${bot.slug}/chat`, POLL_MS);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState<string | null>(null); // the message being answered
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  // The newest message's id, not the count: the data server returns at most 60 messages, so past that the count
  // stays put while new replies keep arriving.
  const lastId = chat.data?.at(-1)?.id ?? 0;

  // Keep the newest message in view as the conversation grows.
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end", behavior: lastId > 0 ? "smooth" : "auto" });
  }, [lastId, sending]);

  useEffect(() => {
    input.current?.focus();
  }, []);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(text);
    setError(null);
    setDraft("");
    const sent = await sendJson<ChatReply>(`/api/bots/${bot.slug}/chat`, "POST", { text });
    if (!sent.ok) {
      setError(sent.body?.error ?? sent.error ?? "request failed");
      setDraft((d) => d || text); // give the text back so it is not lost
    }
    setSending(null);
    chat.reload();
    input.current?.focus();
  }, [bot.slug, chat, draft, sending]);

  const offline = chat.error !== null && chat.data === null;
  const messages = chat.data ?? [];
  // The server saves the message before the model answers, so a poll can show it while the reply is pending:
  // then the grey "your message" bubble would be a duplicate.
  const pendingSaved = sending !== null && messages.slice(-3).some((m) => m.role === "owner" && m.text.trim() === sending);

  return (
    <AppChrome bot={bot} section="chat" title="Chat" subtitle={`Talk with ${bot.name}. It also sees your message on its next step.`}>
      {/* Same two-column grid as the persona page: the conversation, and a sidebar of commands. */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <section className="flex h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-17rem)] min-h-[22rem] min-w-0 flex-col rounded-xl bg-panel sm:h-[calc(100dvh-14rem)]">
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4" aria-live="polite">
          {offline ? (
            <p className="py-10 text-center text-sm text-muted">{chat.error}</p>
          ) : chat.data === null ? (
            <p className="flex items-center justify-center gap-2 py-10 text-sm text-muted">
              <Spinner /> Loading the conversation…
            </p>
          ) : messages.length === 0 && !sending ? (
            <p className="py-10 text-center text-sm text-muted">
              No messages yet. Ask {bot.name} what it has been reading, or give it something to look into.
            </p>
          ) : null}

          <ol className="space-y-3">
            {messages.map((m) => {
              const mine = m.role === "owner";
              return (
                <li key={m.id} className={`group flex items-start gap-1 ${mine ? "justify-end" : "justify-start"}`}>
                  {mine ? <CopyButton text={m.text} what="message" reveal className="mt-1.5" /> : null}
                  <div
                    className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm ${
                      mine
                        ? "bg-sys-blue text-white"
                        : m.role === "system"
                          ? "bg-grouped-3 font-mono text-[13px] text-muted"
                          : "bg-fill-3 text-ink"
                    }`}
                  >
                    <div className={`mb-0.5 text-[11px] ${mine ? "text-white/80" : "text-muted"}`}>
                      {roleLabel(m, bot)} · {clock(m.ts)}
                    </div>
                    <p className="whitespace-pre-wrap break-words">{m.text}</p>
                  </div>
                  {mine ? null : <CopyButton text={m.text} what={m.role === "system" ? "reply" : "message"} reveal className="mt-1.5" />}
                </li>
              );
            })}
            {sending ? (
              <>
                {pendingSaved ? null : (
                  <li className="flex justify-end">
                    <div className="max-w-[85%] rounded-2xl bg-sys-blue/70 px-3.5 py-2 text-sm text-white">
                      <p className="whitespace-pre-wrap break-words">{sending}</p>
                    </div>
                  </li>
                )}
                <li className="flex justify-start">
                  <div className="flex items-center gap-2 rounded-2xl bg-fill-3 px-3.5 py-2 text-sm text-muted">
                    <Spinner small /> {sending.startsWith("/") ? "Running the command…" : `${bot.name} is thinking…`}
                  </div>
                </li>
              </>
            ) : null}
          </ol>
          <div ref={bottom} />
        </div>

        <form
          className="border-t border-line p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          {error ? (
            <p role="alert" className="mb-2 rounded-lg bg-sys-red/10 px-3 py-2 text-sm text-bad">
              {error}
            </p>
          ) : null}
          <div className="flex items-end gap-2">
            <textarea
              ref={input}
              value={draft}
              onChange={(e) => setDraft(e.target.value.slice(0, MAX_CHARS))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void send();
                }
              }}
              rows={2}
              placeholder={offline ? `${bot.name} is offline` : `Message ${bot.name}`}
              enterKeyHint="send"
              disabled={offline}
              className="max-h-40 min-h-[44px] flex-1 resize-y rounded-[1.375rem] bg-fill-3 px-4 py-2.5 text-base text-ink placeholder:text-muted focus:ring-2 focus:ring-sys-blue/40 focus:outline-none disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={!draft.trim() || sending !== null || offline}
              className={`${buttonClass("prominent")} !h-11`}
            >
              {sending ? <Spinner /> : null}
              Send
            </button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted lg:hidden">
            {COMMANDS.map((c) => (
              <button
                key={c.cmd}
                type="button"
                title={c.hint}
                onClick={() => {
                  setDraft(c.cmd);
                  input.current?.focus();
                }}
                className="pressable rounded-full bg-fill-3 px-2.5 py-1 font-mono text-ink hover:bg-fill-2"
              >
                {c.cmd.trim()}
              </button>
            ))}
            <span className="ml-auto hidden [@media(pointer:fine)]:inline">Enter to send · Shift+Enter for a new line</span>
          </div>
        </form>
      </section>

      <aside className="hidden space-y-5 lg:sticky lg:top-[calc(env(safe-area-inset-top)+4.75rem)] lg:block lg:self-start">
        <section className="rounded-xl bg-panel p-4 text-sm">
          <h2 className="mb-1 text-lg font-semibold text-ink">Commands</h2>
          <p className="mb-3 text-xs text-muted">Handled by code, not the model. Click one to start typing it.</p>
          <ul className="space-y-1">
            {COMMANDS.map((c) => (
              <li key={c.cmd}>
                <button
                  type="button"
                  onClick={() => {
                    setDraft(c.cmd);
                    input.current?.focus();
                  }}
                  className="pressable flex w-full items-baseline justify-between gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-fill-3"
                >
                  <span className="font-mono text-ink">{c.cmd.trim()}</span>
                  <span className="truncate text-xs text-muted">{c.hint}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
        <section className="rounded-xl bg-panel p-4 text-sm">
          <h2 className="mb-2 text-lg font-semibold text-ink">How chat works</h2>
          <p className="text-muted">
            {bot.name} replies here, and the running bot also sees your message on its next step. Press Enter to send and Shift+Enter for a new line.
          </p>
        </section>
      </aside>
      </div>
    </AppChrome>
  );
}
