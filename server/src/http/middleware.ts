import type { MiddlewareHandler } from "hono";
import { verifyToken, type AuthClaims } from "../auth/jwt";
import type { Db } from "../db/client";
import { getEmployeeById } from "../repo/employees";

export type Env = { Variables: { auth: AuthClaims } };

function bearer(header: string | undefined): string | null {
  return header?.startsWith("Bearer ") ? header.slice(7) : null;
}

export function requireAuth(db: Db, secret: string): MiddlewareHandler<Env> {
  return async (c, next) => {
    const token = bearer(c.req.header("Authorization"));
    if (!token) return c.json({ error: "unauthorized" }, 401);
    let claims: AuthClaims;
    try {
      claims = await verifyToken(token, secret);
    } catch {
      return c.json({ error: "unauthorized" }, 401);
    }
    const employee = getEmployeeById(db, claims.employeeId);
    if (!employee?.isActive) return c.json({ error: "unauthorized" }, 401);
    c.set("auth", { employeeId: employee.id, isAdmin: employee.isAdmin });
    await next();
  };
}

export function requireAdmin(db: Db, secret: string): MiddlewareHandler<Env> {
  return async (c, next) => {
    const token = bearer(c.req.header("Authorization"));
    if (!token) return c.json({ error: "unauthorized" }, 401);
    let claims: AuthClaims;
    try {
      claims = await verifyToken(token, secret);
    } catch {
      return c.json({ error: "unauthorized" }, 401);
    }
    const employee = getEmployeeById(db, claims.employeeId);
    if (!employee?.isActive) return c.json({ error: "unauthorized" }, 401);
    if (!employee.isAdmin) return c.json({ error: "forbidden" }, 403);
    c.set("auth", { employeeId: employee.id, isAdmin: true });
    await next();
  };
}
