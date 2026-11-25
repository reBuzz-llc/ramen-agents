import type { Db } from "@/lib/db";
import { recordRequest } from "@/lib/samples";

/** An invented signed-in person's id: what makes a change request a person's. */
export const PERSON = "55555555-5555-4555-8555-555555555555";

/** A sample on the web takes a new version only for a signed-in person's open request. Files one; answers its id. */
export const askAsPerson = async (db: Db, tenantId: string, sampleId: string, text = "A person's request") => (await recordRequest(db, tenantId, sampleId, { text, byName: "Olu", byUser: PERSON })).request.id;
