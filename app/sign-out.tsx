"use client";

/** Ends Peek's own session, then back to sign-in. */
export default function SignOut({ className = "text-xs text-muted hover:text-ink" }: { className?: string }) {
  return (
    <button
      type="button"
      className={className}
      onClick={() => {
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
