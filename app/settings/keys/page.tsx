import { notFound } from "next/navigation";
import { pageMe } from "@/lib/page-me";
import { db } from "@/lib/db";
import { can } from "@/lib/roles";
import { defaultScopes, keyDays, listKeys, SCOPES } from "@/lib/api-keys";
import { settingsTitle } from "@/lib/settings-nav";
import SectionHead from "../section-head";
import KeysView from "./keys-view";

export const metadata = { title: settingsTitle("keys") };

export default async function Keys() {
  const who = await pageMe("/settings/keys");
  if (!can(who.role, "keys.manage")) notFound();
  const d = await db();
  const [keys, days] = await Promise.all([listKeys(d, who.tenantId), keyDays(d, who.tenantId)]);
  const iso = (d: Date | null) => (d ? d.toISOString() : null);
  return (
    <>
      <SectionHead slug="keys" />
      <KeysView
        keys={keys.map((k) => ({ ...k, createdAt: k.createdAt.toISOString(), lastUsedAt: iso(k.lastUsedAt), revokedAt: iso(k.revokedAt), today: days.get(k.id) ?? null }))}
        scopes={[...SCOPES]}
        defaults={Object.fromEntries(["engine", "validator", "dashboard", "backfill"].map((n) => [n, defaultScopes(n)]))}
      />
    </>
  );
}
