"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { withAttachments } from "@/lib/attachment-line";
import type { PackLead } from "@/lib/send-pack";

type Others = { userId: string; name: string; leads: { id: string; business: string }[] }[] | null;

async function post(body: Record<string, unknown>): Promise<{ ok: boolean; error?: string; added?: number }> {
  try {
    const r = await fetch("/api/send-pack", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return await r.json();
  } catch {
    return { ok: false, error: "No answer from the server; check the connection and try again." };
  }
}

/** Your send pack: ten leads taken for you, each draft with its open flags, Copy and Mark sent in
 *  place; the owner also sees everyone's. Refreshed from the server after every action. */
export default function SendPack({ pack, size, me, others }: { pack: PackLead[]; size: number; me: string; others: Others }) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<string | null>(pack[0]?.id ?? null);
  const say = (id: string, text: string) => setMsg((m) => ({ ...m, [id]: text }));

  const fill = async () => {
    setBusy("fill");
    const r = await post({ action: "fill" });
    setBusy("");
    say("fill", r.ok ? (r.added ? `${r.added} lead${r.added === 1 ? "" : "s"} taken for you.` : "Send next has nothing more to take right now.") : (r.error ?? "That failed."));
    router.refresh();
  };
  const sent = async (l: PackLead) => {
    setBusy(l.id);
    const r = await post({ action: "sent", id: l.id });
    setBusy("");
    say("fill", r.ok ? `${l.business}: marked sent.${r.added ? " Your pack is topped up." : ""}` : `${l.business}: ${r.error ?? "That failed."}`);
    router.refresh();
  };
  const copy = async (l: PackLead) => {
    try {
      await navigator.clipboard.writeText(withAttachments(l.draft ?? "", l.attachments));
      say(l.id, "Draft copied.");
    } catch {
      say(l.id, "Copy failed: open the lead and select the draft.");
    }
  };

  return (
    <section aria-labelledby="send-pack" className="mt-10">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="send-pack" className="text-lg font-semibold">
          Your send pack <span className="text-sm font-normal text-muted tabular-nums">{pack.length} of {size}</span>
        </h2>
        {pack.length < size ? (
          <button type="button" disabled={busy === "fill"} onClick={fill} className="inline-flex min-h-11 items-center rounded-full bg-accent px-4 text-sm font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-50">
            {busy === "fill" ? "Taking…" : pack.length ? `Top up to ${size}` : `Fill my pack (${size})`}
          </button>
        ) : null}
      </div>
      <p className="mt-1 text-sm text-muted">
        Leads taken for you ({me}), so nobody else sends them. Read the draft and its flags, copy it into your own mailbox, send it, then Mark sent: the next lead
        comes in. A wrong draft: open the lead and fix it first.
      </p>
      {msg.fill ? (
        <p role="status" className="mt-2 text-sm">
          {msg.fill}
        </p>
      ) : null}

      {pack.length === 0 ? (
        <p className="mt-4 rounded-xl border border-line bg-panel p-5 text-sm text-muted">Your pack is empty. Fill it from Send next, or take leads there yourself.</p>
      ) : (
        <ol className="mt-4 space-y-2">
          {pack.map((l, i) => {
            const expanded = open === l.id;
            return (
              <li key={l.id} className="rounded-xl border border-line bg-panel text-sm">
                <button type="button" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : l.id)} className="flex w-full flex-wrap items-baseline justify-between gap-2 p-3 text-left">
                  <span className="font-semibold">
                    {i + 1}. {l.business}
                  </span>
                  <span className="text-xs text-muted">
                    {l.flags.length ? <span className="mr-2 font-semibold text-bad">{l.flags.length} flag{l.flags.length === 1 ? "" : "s"}</span> : null}
                    {l.email ?? "no email"}
                  </span>
                </button>
                {expanded ? (
                  <div className="border-t border-line p-3">
                    <p className="text-muted">
                      {[l.contact, l.role].filter(Boolean).join(", ") || "no contact name"}
                      {l.pkg ? ` · ${l.pkg}` : ""}
                      {l.attachments.length ? ` · attach: ${l.attachments.join(", ")}` : ""}
                    </p>
                    {l.flags.map((f) => (
                      <p key={f.rule} className="mt-2 rounded-lg border-l-4 border-bad bg-bad/10 px-3 py-1.5 text-sm">
                        <span className="font-semibold">{f.rule}</span> {f.detail}
                      </p>
                    ))}
                    <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-bg p-3 font-sans text-sm">{l.draft ?? "No draft yet."}</pre>
                    <div className="mt-2 flex flex-wrap items-center gap-3">
                      {l.draft ? (
                        <button type="button" onClick={() => copy(l)} className="inline-flex min-h-11 items-center rounded-full border border-line px-4 text-sm font-semibold hover:border-accent">
                          Copy draft
                        </button>
                      ) : null}
                      <button
                        type="button"
                        disabled={busy === l.id}
                        onClick={() => sent(l)}
                        className="inline-flex min-h-11 items-center rounded-full bg-accent px-4 text-sm font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-50"
                      >
                        {busy === l.id ? "Marking…" : "Mark sent"}
                      </button>
                      <Link href={`/leads?tab=board&lead=${l.id}`} className="inline-flex min-h-11 items-center text-sm text-accent-ink hover:underline">
                        Open the lead
                      </Link>
                      {msg[l.id] ? <span className="text-xs text-muted">{msg[l.id]}</span> : null}
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}

      {others ? (
        <div className="mt-6">
          <h3 className="text-sm font-semibold">Everyone&apos;s packs</h3>
          {others.length ? (
            <ul className="mt-2 divide-y divide-line rounded-xl border border-line text-sm">
              {others.map((p) => (
                <li key={p.userId} className="px-3 py-2">
                  <span className="font-medium">{p.name}</span> <span className="text-muted tabular-nums">· {p.leads.length} to send</span>
                  <span className="block truncate text-xs text-muted">{p.leads.map((l) => l.business).join(" · ")}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-muted">Nobody holds a lead to send right now.</p>
          )}
        </div>
      ) : null}
    </section>
  );
}
