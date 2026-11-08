"use client";

import Link from "next/link";
import { useState } from "react";
import type { Mark, MarkChoice, Match, Preview } from "@/lib/already-sent";

type PreviewAnswer = { ok: true; preview: Preview; prevented: { now: number; later: number }; capped: boolean } | { ok: false; error: string };
type DoneAnswer = { ok: true; marked: number; failed: { business: string; reason: string }[] } | { ok: false; error: string };

const BY: Record<Match["by"], string> = { id: "its id", email: "its email", domain: "its website's domain", number: "its number" };
// the same names as lib/already-sent's MARKS (a client component cannot import its server code)
const LABEL: Record<Mark, string> = { email_sent: "Email sent", whatsapp_sent: "WhatsApp sent", whatsapp_verified: "WhatsApp Verified", ready_email: "Ready to send email" };
const CHOICES: { key: MarkChoice; label: string }[] = [...(Object.entries(LABEL) as [Mark, string][]).map(([key, label]) => ({ key, label })), { key: "per_line", label: "As each line says" }];
const SEND: Record<Mark, boolean> = { email_sent: true, whatsapp_sent: true, whatsapp_verified: false, ready_email: false };

async function post<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch("/api/leads/already-sent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return (await res.json().catch(() => ({ ok: false, error: `Peek answered ${res.status}` }))) as T;
}

/** Paste (or open a CSV of) the sent mail's recipients or the WhatsApp numbers messaged, preview, then mark. */
export default function AlreadySentView({ me }: { me: string }) {
  const [mark, setMark] = useState<MarkChoice>("email_sent");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<PreviewAnswer | null>(null);
  const [done, setDone] = useState<DoneAnswer | null>(null);

  const reset = () => {
    setPreview(null);
    setDone(null);
  };
  const readFile = async (f: File | undefined) => {
    if (!f) return;
    setText(await f.text());
    reset();
  };
  const run = async (confirm: boolean) => {
    setBusy(true);
    try {
      if (confirm) setDone(await post<DoneAnswer>({ text, mark, confirm: true }));
      else {
        setDone(null);
        setPreview(await post<PreviewAnswer>({ text, mark, confirm: false }));
      }
    } finally {
      setBusy(false);
    }
  };

  const p = preview?.ok ? preview : null;
  const toMark = p ? p.preview.matched.filter((m) => !m.already) : [];
  const already = p ? p.preview.matched.length - toMark.length : 0;
  return (
    <div className="mx-auto max-w-3xl">
      <p className="text-sm">
        <Link href="/leads" className="text-muted hover:text-ink">
          ← Leads
        </Link>
      </p>
      <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-[1.75rem]">Mark already sent</h1>
      <p className="mt-1 text-[0.9375rem] text-muted">
        If the board was imported or rebuilt without who was already emailed, Send next would offer those businesses again. Paste the addresses from your
        mailbox&apos;s Sent folder (or open a CSV export of it), the WhatsApp numbers you messaged, or a list of lead ids. Peek matches them to leads, shows
        you first, and on confirm sets the status you pick as you ({me}): a send on the date in the paste where there is one. A lead already at that step or
        further is left alone. The paste itself is not kept.
      </p>

      <div className="mt-5 flex flex-wrap gap-1 rounded-2xl border border-line bg-panel p-1 text-sm sm:inline-flex sm:rounded-full" role="radiogroup" aria-label="What to set">
        {CHOICES.map((c) => (
          <button
            key={c.key}
            type="button"
            role="radio"
            aria-checked={mark === c.key}
            onClick={() => {
              setMark(c.key);
              reset();
            }}
            className={`min-h-9 rounded-full px-4 font-semibold ${mark === c.key ? "bg-accent text-on-accent" : "text-muted hover:text-ink"}`}
          >
            {c.label}
          </button>
        ))}
      </div>

      <label className="mt-4 block text-sm font-medium">
        {mark === "per_line"
          ? "Lines that each name a status (Email Sent, WhatsApp msg sent, WhatsApp Verified, Ready to Send Email) and a lead id, email or number"
          : "Email addresses, WhatsApp numbers or lead ids, one or more per line (a date on the line is used as the sent date)"}
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            reset();
          }}
          rows={10}
          spellCheck={false}
          placeholder={
            mark === "per_line"
              ? "Bakery,8aee3936-02ce-4080-9fa7-8c4ff030743f,Ready to Send Email\nStudio,4d5f127b-8ad5-4b13-aa40-7589e58072aa,WhatsApp Verified"
              : "owner@bakery.example, 2026-10-21\nhello@studio.example  Oct 23, 2026\n+1 718 555 0100"
          }
          className="mt-1.5 block w-full rounded-lg border border-line bg-panel p-3 font-mono text-sm"
        />
      </label>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <label className="inline-flex min-h-11 cursor-pointer items-center rounded-full border border-line bg-panel px-4 text-sm font-semibold hover:border-accent">
          Open a CSV…
          <input type="file" accept=".csv,.txt,text/csv,text/plain" className="sr-only" onChange={(e) => readFile(e.target.files?.[0])} />
        </label>
        <button
          type="button"
          disabled={busy || !text.trim()}
          onClick={() => run(false)}
          className="inline-flex min-h-11 items-center rounded-full bg-accent px-5 text-sm font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-50"
        >
          {busy && !p ? "Matching…" : "Preview"}
        </button>
      </div>

      {preview && !preview.ok ? <p className="mt-4 rounded-lg bg-panel p-3 text-sm text-bad">{preview.error}</p> : null}

      {p ? (
        <section aria-label="Preview" className="mt-6 space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["To mark", toMark.length],
              ["Already marked", already],
              ["Not found", p.preview.notFound.length + p.preview.noMark.length],
              ["Fit several leads", p.preview.ambiguous.length],
            ].map(([label, n]) => (
              <div key={label} className="rounded-xl border border-line bg-panel p-3">
                <p className="text-xs text-muted">{label}</p>
                <p className="text-2xl font-semibold tabular-nums">{n}</p>
              </div>
            ))}
          </div>
          <p data-prevented className="rounded-lg border-l-4 border-accent bg-panel px-3 py-2 text-sm">
            {p.prevented.now + p.prevented.later > 0 ? (
              <>
                Send next offers <strong>{p.prevented.now}</strong> of these right now, and <strong>{p.prevented.later}</strong> more have a draft waiting:
                marking them keeps {p.prevented.now + p.prevented.later === 1 ? "that business" : `those ${p.prevented.now + p.prevented.later} businesses`}{" "}
                from a second first email.
              </>
            ) : (
              <>Send next offers none of these, so nothing there changes; the statuses are set as you, so the agents leave them alone.</>
            )}
          </p>
          {p.capped ? <p className="text-sm text-muted">Only the first 5,000 addresses were read; paste the rest after this.</p> : null}

          {toMark.length ? (
            <div className="overflow-x-auto rounded-xl border border-line">
              <table className="w-full text-sm">
                <thead className="bg-panel text-left text-xs text-muted">
                  <tr>
                    <th className="px-3 py-2 font-medium">Lead</th>
                    <th className="px-3 py-2 font-medium">Matched by</th>
                    <th className="px-3 py-2 font-medium">Set to</th>
                  </tr>
                </thead>
                <tbody>
                  {toMark.slice(0, 200).map((m) => (
                    <tr key={`${m.leadId}:${m.mark}`} className="border-t border-line">
                      <td className="px-3 py-1.5">
                        <Link href={`/leads/${m.leadId}`} className="font-medium hover:underline">
                          {m.business}
                        </Link>
                        <span className="block text-xs text-muted">{m.key}</span>
                      </td>
                      <td className="px-3 py-1.5 text-muted">{BY[m.by]}</td>
                      <td className="px-3 py-1.5">
                        {LABEL[m.mark]}
                        {SEND[m.mark] ? <span className="block text-xs text-muted tabular-nums">sent {m.date ?? "today"}</span> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {toMark.length > 200 ? <p className="border-t border-line px-3 py-2 text-xs text-muted">and {toMark.length - 200} more</p> : null}
            </div>
          ) : null}

          {p.preview.notFound.length || p.preview.ambiguous.length || p.preview.noMark.length ? (
            <details className="rounded-xl border border-line p-3 text-sm">
              <summary className="cursor-pointer font-medium">Not marked: {p.preview.notFound.length + p.preview.ambiguous.length + p.preview.noMark.length}</summary>
              {p.preview.noMark.length ? <p className="mt-2 text-muted">These lines name no status: {p.preview.noMark.slice(0, 100).join(", ")}</p> : null}
              {p.preview.ambiguous.length ? (
                <p className="mt-2 text-muted">
                  Fit more than one lead, so not marked (open the lead and use its status chip):{" "}
                  {p.preview.ambiguous.map((a) => `${a.key} (${a.leads})`).join(", ")}
                </p>
              ) : null}
              {p.preview.notFound.length ? <p className="mt-2 text-muted">Not on the board: {p.preview.notFound.slice(0, 300).join(", ")}</p> : null}
            </details>
          ) : null}

          {done?.ok ? (
            <p role="status" className="rounded-lg bg-panel p-3 text-sm">
              Set <strong>{done.marked}</strong> status{done.marked === 1 ? "" : "es"} as you.
              {done.failed.length ? ` Not marked: ${done.failed.map((f) => `${f.business} (${f.reason})`).join("; ")}.` : ""} Send next no longer offers the ones marked sent.
            </p>
          ) : done && !done.ok ? (
            <p className="rounded-lg bg-panel p-3 text-sm text-bad">{done.error}</p>
          ) : toMark.length ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => run(true)}
              className="inline-flex min-h-11 items-center rounded-full bg-accent px-5 text-sm font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-50"
            >
              {busy ? "Setting…" : mark === "per_line" ? `Set ${toMark.length} as each line says` : `Mark ${toMark.length} as ${LABEL[mark]}`}
            </button>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
