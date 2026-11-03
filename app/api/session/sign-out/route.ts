import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE, endSession } from "@/lib/auth";
import { db } from "@/lib/db";

export async function POST(req: Request) {
  const jar = await cookies();
  await endSession(await db(), jar.get(COOKIE)?.value);
  // The development session is ended here; the Neon Auth session is ended by the page's client (authClient.signOut()).
  const res = NextResponse.redirect(new URL("/sign-in", req.url), 303);
  res.cookies.delete(COOKIE);
  return res;
}
