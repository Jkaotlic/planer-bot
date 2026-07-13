import type { MiddlewareHandler } from "hono";
import { verifyToken, type AuthClaims } from "../auth/jwt";

export type Env = { Variables: { auth: AuthClaims } };

function bearer(header: string | undefined): string | null {
  return header?.startsWith("Bearer ") ? header.slice(7) : null;
}

export function requireAuth(secret: string): MiddlewareHandler<Env> {
  return async (c, next) => {
    const token = bearer(c.req.header("Authorization"));
    if (!token) return c.json({ error: "unauthorized" }, 401);
    try {
      c.set("auth", await verifyToken(token, secret));
    } catch {
      return c.json({ error: "unauthorized" }, 401);
    }
    await next();
  };
}

export function requireAdmin(secret: string): MiddlewareHandler<Env> {
  return async (c, next) => {
    const token = bearer(c.req.header("Authorization"));
    if (!token) return c.json({ error: "unauthorized" }, 401);
    let claims: AuthClaims;
    try {
      claims = await verifyToken(token, secret);
    } catch {
      return c.json({ error: "unauthorized" }, 401);
    }
    if (!claims.isAdmin) return c.json({ error: "forbidden" }, 403);
    c.set("auth", claims);
    await next();
  };
}
