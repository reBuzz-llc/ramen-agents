import { redirect } from "next/navigation";
import { signedInWithoutAccess } from "@/lib/auth";
import SignOut from "../sign-out";

// Reads the session cookie: never prerendered.
export const dynamic = "force-dynamic";

export const metadata = { title: "No access · ramen-agents" };

export default async function NoAccess() {
  const email = await signedInWithoutAccess();
  if (!email) redirect("/sign-in");
  return (
    <div className="mx-auto max-w-md space-y-3">
      <h1 className="text-2xl font-bold tracking-tight sm:text-[1.75rem]">Not on a team yet</h1>
      <p className="text-sm">You are signed in as {email}, but no company has added you. Ask your company&apos;s owner or a manager to add this Google address (Settings → People → Add member), then sign in again.</p>
      <SignOut />
    </div>
  );
}
