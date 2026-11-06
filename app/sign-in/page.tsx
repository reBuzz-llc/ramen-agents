import Link from "next/link";
import { redirect } from "next/navigation";
import { devLoginEnabled, me, signedInWithoutAccess } from "@/lib/auth";
import { neonAuth } from "@/lib/neon-auth";
import { localMode } from "@/lib/local-codes";
import { googleSignIn } from "@/lib/google-signin";
import { safeNext } from "@/lib/return-path";
import SignInForm from "./sign-in-form";
import { btnOutline, control, fieldLabel, pageLead, pageTitle } from "@/lib/ui-classes";

// Reads the session cookie: never prerendered.
export const dynamic = "force-dynamic";

export const metadata = { title: "Sign in · ramen-agents" };

export default async function SignIn(props: PageProps<"/sign-in">) {
  const sp = await props.searchParams;
  // where the person was going (a deep link), kept through Google and the welcome step
  const next = safeNext(sp.next);
  if (await me()) redirect(next ?? "/leads");
  if (await signedInWithoutAccess()) redirect("/no-access");
  const error = sp.error;
  return (
    <div className="mx-auto max-w-sm">
      <h1 className={pageTitle}>Sign in</h1>
      <p className={pageLead}>One queue: the agents fill it, your team finishes it.</p>
      {localMode() ? (
        <>
          <p className="mt-3 text-[0.9375rem]">
            Sign-in with Google is paused for now. Sign in with your work email and the code the owner gave you.
          </p>
          {error ? <p role="alert" className="mt-4 rounded-xl bg-bad/10 p-3 text-sm text-bad">{String(error)}</p> : null}
          <form action="/api/local-sign-in" method="post" className="mt-6 space-y-3">
            {next ? <input type="hidden" name="next" value={next} /> : null}
            <label className={fieldLabel}>
              Work email
              <input name="email" type="email" required autoComplete="email" className={control} />
            </label>
            <label className={fieldLabel}>
              Code
              <input name="code" required autoComplete="one-time-code" placeholder="ABCD-EFGH-JK" className={`${control} font-mono uppercase`} />
            </label>
            <button className={btnOutline}>Sign in</button>
          </form>
        </>
      ) : (
        <>
          <p className="mt-3 text-[0.9375rem]">
            Sign in with the Google account your company added you with. Another Google address gets no access.
          </p>
          {error ? <p role="alert" className="mt-4 rounded-xl bg-bad/10 p-3 text-sm text-bad">{String(error)}</p> : null}
          <div className="mt-6">
            {googleSignIn() ? (
              // The portal's own Google sign-in: no Neon Auth
              <a href={`/api/google-signin/start${next ? `?next=${encodeURIComponent(next)}` : ""}`} className={`${btnOutline} inline-flex items-center gap-2`}>
                <svg width={18} height={18} viewBox="0 0 48 48" aria-hidden>
                  <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.5l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.8 6C12.4 13.6 17.7 9.5 24 9.5z" />
                  <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.7c4.3-4 6.9-9.9 6.9-17.1z" />
                  <path fill="#FBBC05" d="M10.5 28.7c-.5-1.4-.8-3-.8-4.7s.3-3.2.8-4.7l-7.8-6C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.8-6z" />
                  <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.8 2.2-8.5 2.2-6.3 0-11.6-4.1-13.5-9.8l-7.8 6C6.6 42.6 14.6 48 24 48z" />
                </svg>
                Continue with Google
              </a>
            ) : neonAuth ? (
              <SignInForm next={next} />
            ) : (
              <p className="text-sm text-muted">Sign-in is not configured: set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.</p>
            )}
          </div>
        </>
      )}
      {devLoginEnabled() ? (
        <form action="/api/dev-login" method="post" className="mt-8 rounded-xl border border-dashed border-line p-4">
          <p className="text-xs font-semibold tracking-wide text-muted uppercase">Development sign-in (this machine only)</p>
          <label className={`${fieldLabel} mt-3`}>
            Email
            <input name="email" type="email" required className={control} />
          </label>
          {next ? <input type="hidden" name="next" value={next} /> : null}
          <label className={`${fieldLabel} mt-3`}>
            Name (first sign-in only)
            <input name="name" className={control} />
          </label>
          <button className={`${btnOutline} mt-4`}>Sign in</button>
          <p className="mt-2 text-xs text-muted">On an empty database the first person to sign in becomes the owner of the company &quot;My team&quot; (rename it in Settings later).</p>
        </form>
      ) : null}
      <p className="mt-8 text-sm text-muted">
        New here?{" "}
        <Link href="/guide" className="font-medium text-accent-ink underline">
          The guide
        </Link>{" "}
        shows what you do here, step by step.
      </p>
    </div>
  );
}
