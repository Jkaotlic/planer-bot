import { Hono } from "hono";
import type { Config } from "../../config";
import type { Db } from "../../db/client";
import { audienceCandidates } from "../../team/audience";
import { teamNow } from "../../util/team-time";
import { requireAuth, type Env } from "../middleware";

/** Кого можно позвать в опрос или заказ — любому работнику, не только анонсёру. */
export function createTeamAudienceRoutes(db: Db, config: Config): Hono<Env> {
  const app = new Hono<Env>();
  app.get("/api/team-audience", requireAuth(db, config.jwtSecret), (c) =>
    c.json({ candidates: audienceCandidates(db, c.get("auth").employeeId, teamNow(config.teamTz).date) }),
  );
  return app;
}
