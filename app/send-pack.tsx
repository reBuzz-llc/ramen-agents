"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { withAttachments } from "@/lib/attachment-line";
import { withSample } from "@/lib/sample-site";
import DraftBox from "./draft-box";
import type { PackLead } from "@/lib/send-pack";
import { doneLine, type Budget } from "@/lib/send-goals";

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
export default function SendPack({ pack: held, size: most, me, others, today }: { pack: PackLead[]; size: number; me: string; others: Others; today: Budget }) {
  // the day's send goal: the pack shows and fills only what is left today; leads held past it wait for tomorrow
  const size = Math.min(most, today.left);
  const pack = held.slice(0, size);
  const later = held.length - pack.length;
  const done = today.left <= 0;
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<Record<string, string>>({});
  // undefined: nothing chosen yet, so the first lead is open (also when the pack fills after the page loaded); null: all closed
  const [open, setOpen] = useState<string | null | undefined>(undefined);
  const shown = open === undefined ? (pack[0]?.id ?? null) : open;
  const say = (id: string, text: string) => setMsg((m) => ({ ...m, [id]: text }));
  // drafts saved here: Copy uses them at once, before the page refreshes
  const [edited, setEdited] = useState<Record<string, string>>({});
  const draftOf = (l: PackLead) => edited[l.id] ?? l.draft;

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
      await navigator.clipboard.writeText(withAttachments(withSample(draftOf(l) ?? "", l.sample), l.attachments));
      say(l.id, "Draft copied.");
    } catch {
      say(l.id, "Copy failed: open the lead and select the draft.");
    }
  };

  return (
    <section aria-labelledby="send-pack" className="mt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="send-pack" className="text-lg font-semibold">
          Your send pack{" "}
          <span data-sent-today className="text-sm font-normal text-muted tabular-nums">
            · {today.sent} of {today.goal} sent today
          </span>
        </h2>
        {done ? (
          <button type="button" disabled className="inline-flex min-h-11 items-center rounded-full bg-accent px-4 text-sm font-semibold text-on-accent disabled:opacity-50">
            Fill my pack
          </button>
        ) : pack.length < size ? (
          <button type="button" disabled={busy === "fill"} onClick={fill} className="inline-flex min-h-11 items-center rounded-full bg-accent px-4 text-sm font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-50">
            {busy === "fill" ? "Taking…" : pack.length ? `Top up to ${size}` : `Fill my pack (${size})`}
          </button>
        ) : null}
      </div>
      <p className="mt-1 text-sm text-muted">
        Leads taken for you ({me}), so nobody else sends them. Read the draft and its flags, copy it into your own mailbox, send it, then Mark sent: the next lead
        comes in. A wrong draft: open the lead and fix it first. {today.goal} emails a day each: more from one address lands in spam.
      </p>
      {done ? (
        <p data-goal-done className="mt-2 rounded-lg bg-good/10 px-3 py-2 text-sm font-semibold">
          {doneLine(today.goal)}
        </p>
      ) : null}
      {later > 0 ? (
        <p className="mt-1 text-xs text-muted">
          {later} more lead{later === 1 ? " stays" : "s stay"} in your pack for tomorrow.
        </p>
      ) : null}
      {msg.fill ? (
        <p role="status" className="mt-2 text-sm">
          {msg.fill}
        </p>
      ) : null}

      {pack.length === 0 && done ? null : pack.length === 0 ? (
        <p className="mt-4 rounded-xl border border-line bg-panel p-5 text-sm text-muted">Your pack is empty. Fill it from Send next, or take leads there yourself.</p>
      ) : (
        <ol className="mt-4 space-y-2">
          {pack.map((l, i) => {
            const expanded = shown === l.id;
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
                    {l.sample ? <SampleLine url={l.sample} /> : null}
                    {l.flags.map((f) => (
                      <p key={f.rule} className={`mt-2 rounded-lg border-l-4 px-3 py-1.5 text-sm ${f.changed || edited[l.id] !== undefined ? "border-line bg-bg" : "border-bad bg-bad/10"}`}>
                        <span className="font-semibold">{f.rule}</span> {f.detail}
                        {f.changed || edited[l.id] !== undefined ? <span className="block text-xs text-muted">You changed the draft after this flag; the Validator checks it again on its next run.</span> : null}
                      </p>
                    ))}
                    {draftOf(l) ? (
                      <DraftBox
                        leadId={l.id}
                        field="draft_email"
                        text={draftOf(l)!}
                        onSaved={(t) => {
                          setEdited((e) => ({ ...e, [l.id]: t }));
                          say(l.id, "Draft saved as yours.");
                          router.refresh();
                        }}
                      />
                    ) : (
                      <p className="mt-2 text-sm text-muted">No draft yet.</p>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-3">
                      {draftOf(l) ? (
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

/** The lead's sample site on its card: the link to open and check it before sending. */
export function SampleLine({ url }: { url: string }) {
  return (
    <p className="mt-1 text-sm">
      <span className="text-muted">Sample site: </span>
      <a href={url} target="_blank" rel="noopener" className="font-semibold text-accent-ink underline">
        Open
      </a>
      <span className="ml-2 text-xs break-all text-muted">{url}</span>
    </p>
  );
}
