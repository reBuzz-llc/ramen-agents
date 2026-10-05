// Server-side only: who is looking at the dashboard, for the profile menu. The same check proxy.ts applies.
import { headers } from "next/headers";
import { checkAccess } from "./access";

export type Identity = { name: string; detail: string; initials: string };

export async function currentIdentity(): Promise<Identity> {
  const access = await checkAccess(await headers());
  if (access.ok && access.via === "tailscale") {
    const local = access.user.split("@")[0];
    return {
      name: local,
      detail: `${access.user} · via Tailscale`,
      initials: local.replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase() || "ME",
    };
  }
  return { name: "Owner", detail: "On this Mac", initials: "ME" };
}
