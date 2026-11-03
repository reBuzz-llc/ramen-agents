"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { copyText, signInLink } from "@/lib/team-text";
import { PendingButton } from "../ui";
import { btnDanger, control, fieldLabel, helper, sectionTitle } from "@/lib/ui-classes";

async function post(body: object): Promise<{ ok: boolean; error?: string; member?: { email: string } }> {
  try {
    const r = await fetch("/api/team", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return await r.json();
  } catch {
    return { ok: false, error: "No answer from the server; check the connection and try again." };
  }
}

/** Settings → People → Add member by Google email: email, name and role; the person's row appears in the list as
 *  "invited, not signed in yet", with the copy icon for the message to send them. */
export default function AddMember({ canAddManager, ownerName = "" }: { canAddManager: boolean; ownerName?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [added, setAdded] = useState<{ email: string; name: string } | null>(null);
  const router = useRouter();
  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    setBusy(true);
    setError("");
    const r = await post({ action: "add", email: f.get("email"), name: f.get("name"), role: f.get("role") });
    setBusy(false);
    if (!r.ok || !r.member) return setError(r.error ?? "Could not add them.");
    setAdded({ email: r.member.email, name: String(f.get("name") ?? "") });
    form.reset();
    router.refresh();
  };
  return (
    <section aria-labelledby="add-member" className="rounded-2xl bg-panel p-5">
      <h2 id="add-member" className={sectionTitle}>Add member by Google email</h2>
      <p className={helper}>
        Enter the Google address they sign in with. They are on the team the first time they sign in with Google using
        exactly that address; until then their row says &quot;invited, not signed in yet&quot;.
        {canAddManager ? "" : " Managers add members; the owner adds managers."}
      </p>
      <form onSubmit={submit} className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_minmax(0,1fr)]">
        <label className={fieldLabel}>
          Google email
          <input name="email" type="email" required autoComplete="off" placeholder="name@gmail.com" className={control} />
        </label>
        <label className={fieldLabel}>
          Name
          <input name="name" autoComplete="off" className={control} />
        </label>
        <label className={fieldLabel}>
          Role
          <select name="role" className={control}>
            <option value="member">Member</option>
            {canAddManager ? <option value="manager">Manager</option> : null}
          </select>
        </label>
        <div className="sm:col-span-3">
          <PendingButton type="submit" pending={busy} pendingLabel="Adding…" className="text-base">
            Add member
          </PendingButton>
        </div>
      </form>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-bad">
          {error}
        </p>
      ) : null}
      {added ? (
        <p role="status" className="mt-3 flex flex-wrap items-center gap-2 text-[0.9375rem]">
          {added.email} is on the list. Send them the invite: <CopySignIn email={added.email} name={added.name} ownerName={ownerName} />
        </p>
      ) : null}
    </section>
  );
}

/** Two copy icons for a new member: the whole invite (who, where, which Google address, what to do first, who to
 *  ask), ready to paste on Slack or WhatsApp; and the sign-in link only. */
export function CopySignIn({ email, name = "", ownerName = "" }: { email: string; name?: string; ownerName?: string }) {
  const [done, setDone] = useState<"" | "invite" | "link" | "failed">("");
  const copy = async (what: "invite" | "link") => {
    try {
      await navigator.clipboard.writeText(what === "invite" ? copyText(window.location.origin, { email, name, ownerName }) : signInLink(window.location.origin));
      setDone(what);
    } catch {
      setDone("failed");
    }
    setTimeout(() => setDone(""), 2500);
  };
  const icon = (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
    </svg>
  );
  const link = (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
    </svg>
  );
  return (
    <span className="inline-flex items-center gap-3">
      <button type="button" onClick={() => void copy("invite")} title="Copy the invite to paste on Slack or WhatsApp" aria-label={`Copy the invite for ${email}`} className="inline-flex min-h-11 items-center gap-1 text-sm text-accent-ink hover:underline">
        {icon} {done === "invite" ? "Invite copied" : "Copy invite"}
      </button>
      <button type="button" onClick={() => void copy("link")} title="Copy the sign-in link only" aria-label={`Copy the sign-in link for ${email}`} className="inline-flex min-h-11 items-center gap-1 text-sm text-muted hover:text-ink hover:underline">
        {link} {done === "link" ? "Link copied" : "Copy link only"}
      </button>
      {done === "failed" ? <span role="alert" className="text-sm text-bad">Copy failed</span> : null}
    </span>
  );
}

/** "Remove": someone who never signed in is deleted; someone who did keeps their hours and outcomes but can't get in. */
export function RemoveMember({ userId, email }: { userId: string; email: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          if (!window.confirm(`Remove ${email} from the team? They can no longer sign in; their hours and outcomes stay.`)) return;
          setBusy(true);
          setError("");
          const r = await post({ action: "remove", userId });
          setBusy(false);
          if (!r.ok) return setError(r.error ?? "Could not remove them.");
          router.refresh();
        }}
        className={btnDanger}
      >
        {busy ? "Removing…" : "Remove"}
      </button>
      {error ? <span role="alert" className="text-sm text-bad">{error}</span> : null}
    </span>
  );
}
