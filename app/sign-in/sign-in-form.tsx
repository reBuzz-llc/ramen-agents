"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { authMessage } from "@/lib/auth-errors";

/** Sign-in is Google only.
 * Nobody makes an account here: the owner or a manager adds a person's Google address in Settings → People, and their
 * first Google sign-in with that address lets them in. Neon's client throws on a refused request instead of returning
 * the error, so the call is caught and its message shown under the button (a form that froze greyed, 2026-11-02). */
export default function SignInForm({ next = null }: { next?: string | null }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const google = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await authClient.signIn.social({ provider: "google", callbackURL: `${window.location.origin}${next ?? "/leads"}` });
      if (r?.error) throw r.error;
    } catch (err) {
      setError(authMessage(err));
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3">
      <button
        type="button"
        disabled={busy}
        onClick={google}
        className="w-full rounded-full bg-accent px-4 py-2.5 text-sm font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-40"
      >
        {busy ? "Opening Google…" : "Continue with Google"}
      </button>
      {error ? (
        <p role="alert" className="text-sm text-bad">
          {error}
        </p>
      ) : null}
    </div>
  );
}
