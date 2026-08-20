import type { MiddlewareHandler } from "hono";
import { canAnnounce } from "@planer/shared";
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

/**
 * Кто может разослать объявление: админ или наблюдатель.
 *
 * Отдельный мидлвар, а не флаг у `requireAdmin`: над всем `/api/admin/*` висит
 * сплошной `requireAdmin` как защита от роута, забывшего свой гейт, и снимать
 * её нельзя. Поэтому рассылка живёт вне этого префикса — и ей нужен свой
 * привратник. Роль читается из строки БД, а не из токена: снятая админом, она
 * должна переставать действовать сразу, а не когда истечёт токен.
 */
export function requireAnnouncer(db: Db, secret: string): MiddlewareHandler<Env> {
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
    if (!canAnnounce(employee)) return c.json({ error: "forbidden" }, 403);
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
