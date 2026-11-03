"use client";

import { authClient } from "@/lib/auth-client";

/** Ends the Neon Auth session (if any) and the development session (if any), then back to sign-in. */
export default function SignOut({ className = "text-xs text-muted hover:text-ink" }: { className?: string }) {
  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        try {
          await authClient.signOut();
        } catch {
          /* no Neon Auth session */
        }
        const form = document.createElement("form");
        form.method = "post";
        form.action = "/api/session/sign-out";
        document.body.appendChild(form);
        form.submit();
      }}
    >
      Sign out
    </button>
  );
}
