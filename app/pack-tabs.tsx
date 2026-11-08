"use client";

import { useState, type ReactNode } from "react";

/** The send pack's two sides: Email (the ten leads to email) and WhatsApp (check numbers, then
 *  send to the verified ones). Both are rendered on the server; this only switches between them. */
export default function PackTabs({ email, whatsapp, waCount }: { email: ReactNode; whatsapp: ReactNode; waCount: number }) {
  const [tab, setTab] = useState<"email" | "whatsapp">("email");
  return (
    <div className="mt-10">
      <div role="tablist" aria-label="Send pack" className="inline-flex rounded-full border border-line bg-panel p-1 text-sm">
        {(["email", "whatsapp"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`min-h-9 rounded-full px-4 font-semibold ${tab === t ? "bg-accent text-on-accent" : "text-muted hover:text-ink"}`}
          >
            {t === "email" ? "Email" : `WhatsApp${waCount ? ` · ${waCount}` : ""}`}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {tab === "email" ? email : whatsapp}
      </div>
    </div>
  );
}
