// Neon Auth's endpoints (Google sign-in, sign-out, the OAuth callback), proxied to the branch's managed Better Auth. The
// admin endpoints are never proxied: nothing in a browser may call them.
import { neonAuth } from "@/lib/neon-auth";

type Handler = (req: Request, ctx: { params: Promise<{ path: string[] }> }) => Promise<Response>;

const off = () => Response.json({ error: "Neon Auth is not configured (NEON_AUTH_BASE_URL)" }, { status: 503 });
const h = neonAuth?.handler() as Record<"GET" | "POST" | "PUT" | "DELETE" | "PATCH", Handler> | undefined;

const guarded =
  (fn: Handler | undefined): Handler =>
  async (req, ctx) => {
    if (!fn) return off();
    const { path } = await ctx.params;
    if (path[0] === "admin") return Response.json({ error: "not available" }, { status: 404 });
    return fn(req, ctx);
  };

export const GET = guarded(h?.GET);
export const POST = guarded(h?.POST);
export const PUT = guarded(h?.PUT);
export const DELETE = guarded(h?.DELETE);
export const PATCH = guarded(h?.PATCH);
