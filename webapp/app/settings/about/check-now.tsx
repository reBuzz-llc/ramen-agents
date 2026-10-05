"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { sendJson } from "@/lib/client";
import { buttonClass, Spinner } from "../../ui";

export default function CheckNow() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const sent = await sendJson<{ summary?: string }>("/api/settings/brandkit", "POST", {});
          setSummary(sent.body?.summary ?? sent.error ?? "check failed");
          setBusy(false);
          router.refresh();
        }}
        className={buttonClass("tinted", "sm")}
      >
        {busy ? <Spinner small /> : null}
        {busy ? "Checking Apple…" : "Check now"}
      </button>
      {summary ? <span role="status" className="text-xs text-muted">{summary.replace(/^applebrandkit: /, "")}</span> : null}
    </div>
  );
}
