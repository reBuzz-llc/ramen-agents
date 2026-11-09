"use client";

import { withSample } from "@/lib/sample-site";
import { SampleLine } from "./send-pack";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { WaLead } from "@/lib/whatsapp-pack";
import DraftBox from "./draft-box";

async function post(body: Record<string, unknown>): Promise<{ ok: boolean; error?: string; added?: number }> {
  try {
    const r = await fetch("/api/whatsapp-pack", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return await r.json();
  } catch {
    return { ok: false, error: "No answer from the server; check the connection and try again." };
  }
}

/** The number as people read it: "+17185551000", from the WhatsApp cell (a wa.me link or a number) or the phone. */
const shownNumber = (l: WaLead) => {
  const digits = ((l.whatsapp ?? "").replace(/^https?:\/\/(wa\.me|api\.whatsapp\.com)\/(send\?phone=)?/i, "") || l.phone || "").replace(/\D/g, "");
  return digits ? `+${digits}` : "";
};

const btn = "inline-flex min-h-10 items-center rounded-full px-3.5 text-sm font-semibold disabled:opacity-50";

/** The pack's WhatsApp tab: check numbers, then send to the verified ones. */
export default function WhatsAppPack({ checks, send, size }: { checks: WaLead[]; send: WaLead[]; size: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  // messages saved here: Copy uses them at once, before the page refreshes
  const [edited, setEdited] = useState<Record<string, string>>({});
  const msgOf = (l: WaLead) => edited[l.id] ?? l.draft;
  const act = async (id: string, body: Record<string, unknown>, done: string) => {
    setBusy(id);
    const r = await post(body);
    setBusy("");
    setNote(r.ok ? done : (r.error ?? "That failed."));
    router.refresh();
  };
  const copy = async (l: WaLead) => {
    try {
      await navigator.clipboard.writeText(withSample(msgOf(l) ?? "", l.sample));
      setNote(`${l.business}: message copied.`);
    } catch {
      setNote("Copy failed: open the lead and select the message.");
    }
  };
  const ready = send.filter((l) => l.draft);
  const coming = send.filter((l) => !l.draft);

  return (
    <div>
      {note ? (
        <p role="status" className="mt-2 text-sm">
          {note}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-baseline justify-between gap-3">
        <h3 className="font-semibold">
          Send on WhatsApp <span className="text-sm font-normal text-muted tabular-nums">{ready.length}</span>
        </h3>
      </div>
      <p className="mt-1 text-sm text-muted">Verified numbers with a message ready. Copy it, open the chat, send it from WhatsApp, then Mark WhatsApp sent.</p>
      {ready.length === 0 ? (
        <p className="mt-3 rounded-xl border border-line bg-panel p-4 text-sm text-muted">Nothing ready to send yet: check numbers below, and the agents draft for the verified ones.</p>
      ) : (
        <ol className="mt-3 space-y-2">
          {ready.map((l) => (
            <li key={l.id} className="rounded-xl border border-line bg-panel p-3 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-semibold">{l.business}</span>
                <span className="text-xs text-muted tabular-nums">{shownNumber(l)}</span>
              </div>
              {l.sample ? <SampleLine url={l.sample} /> : null}
              {l.flags.map((f) => (
                <p key={f.rule} className={`mt-2 rounded-lg border-l-4 px-3 py-1.5 ${f.changed || edited[l.id] !== undefined ? "border-line bg-bg" : "border-bad bg-bad/10"}`}>
                  <span className="font-semibold">{f.rule}</span> {f.detail}
                  {f.changed || edited[l.id] !== undefined ? <span className="block text-xs text-muted">You changed the message after this flag; the Validator checks it again on its next run.</span> : null}
                </p>
              ))}
              <DraftBox
                leadId={l.id}
                field="draft_whatsapp"
                text={msgOf(l) ?? ""}
                onSaved={(t) => {
                  setEdited((e) => ({ ...e, [l.id]: t }));
                  setNote(`${l.business}: message saved as yours.`);
                  router.refresh();
                }}
              />
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <button type="button" onClick={() => copy(l)} className={`${btn} border border-line hover:border-accent`}>
                  Copy message
                </button>
                {l.link ? (
                  <a href={l.link} target="_blank" rel="noopener" className={`${btn} border border-line hover:border-accent`}>
                    Open in WhatsApp
                  </a>
                ) : null}
                <button type="button" disabled={busy === l.id} onClick={() => act(l.id, { action: "sent", id: l.id }, `${l.business}: WhatsApp sent.`)} className={`${btn} bg-accent text-on-accent hover:bg-accent-hover`}>
                  Mark WhatsApp sent
                </button>
                <Link href={`/leads?tab=board&lead=${l.id}`} className="text-sm text-accent-ink hover:underline">
                  Open the lead
                </Link>
              </div>
            </li>
          ))}
        </ol>
      )}
      {coming.length ? (
        <p className="mt-2 text-sm text-muted">
          Verified, draft coming: {coming.map((l) => l.business).join(" · ")}. The agents write these next.
        </p>
      ) : null}

      <div className="mt-8 flex flex-wrap items-baseline justify-between gap-3">
        <h3 className="font-semibold">
          Check numbers <span className="text-sm font-normal text-muted tabular-nums">{checks.length} of {size}</span>
        </h3>
        {checks.length < size ? (
          <button type="button" disabled={busy === "fill"} onClick={() => act("fill", { action: "fill" }, "Numbers taken for you.")} className={`${btn} bg-accent text-on-accent hover:bg-accent-hover`}>
            {busy === "fill" ? "Taking…" : checks.length ? `Top up to ${size}` : `Take ${size} numbers`}
          </button>
        ) : null}
      </div>
      <p className="mt-1 text-sm text-muted">
        Open each chat: if WhatsApp shows the business, press Verified. If you asked them to confirm, Asked to verify, and later Verified or False number. Not on
        WhatsApp: False number. Nobody else gets these numbers while you hold them.
      </p>
      {checks.length === 0 ? (
        <p className="mt-3 rounded-xl border border-line bg-panel p-4 text-sm text-muted">No numbers to check. Take some to start.</p>
      ) : (
        <ul className="mt-3 divide-y divide-line rounded-xl border border-line text-sm">
          {checks.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <span className="min-w-0">
                <span className="font-medium">{l.business}</span>
                <span className="block text-xs text-muted">
                  {shownNumber(l)}
                  {l.status ? " · asked, waiting" : ""}
                </span>
              </span>
              <span className="flex flex-wrap items-center gap-1.5">
                {l.link ? (
                  <a href={l.link} target="_blank" rel="noopener" className={`${btn} border border-line hover:border-accent`}>
                    Open in WhatsApp
                  </a>
                ) : null}
                <button type="button" disabled={busy === l.id} onClick={() => act(l.id, { action: "check", id: l.id, status: "verified" }, `${l.business}: verified.`)} className={`${btn} border border-accent hover:bg-accent-tint`}>
                  Verified
                </button>
                {!l.status ? (
                  <button type="button" disabled={busy === l.id} onClick={() => act(l.id, { action: "check", id: l.id, status: "asked" }, `${l.business}: asked to verify.`)} className={`${btn} border border-line hover:border-accent`}>
                    Asked to verify
                  </button>
                ) : null}
                <button type="button" disabled={busy === l.id} onClick={() => act(l.id, { action: "check", id: l.id, status: "false" }, `${l.business}: false number, let go.`)} className={`${btn} border border-line text-muted hover:border-bad`}>
                  False number
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
