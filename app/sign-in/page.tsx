import Link from "next/link";
import { redirect } from "next/navigation";
import { devLoginEnabled, me, signedInWithoutAccess } from "@/lib/auth";
import { neonAuth } from "@/lib/neon-auth";
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
      <p className="mt-3 text-[0.9375rem]">
        Sign in with the Google account your company added you with. Another Google address gets no access.
      </p>
      {error ? <p role="alert" className="mt-4 rounded-xl bg-bad/10 p-3 text-sm text-bad">{String(error)}</p> : null}
      <div className="mt-6">{neonAuth ? <SignInForm next={next} /> : <p className="text-sm text-muted">Sign-in is not configured: run `neon env pull` to add NEON_AUTH_BASE_URL.</p>}</div>
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
