import { describe, it, expect } from "vitest";
import { createApp } from "./app";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount } from "../repo/employees";
import { signInitData } from "../auth/telegram";
import type { Config } from "../config";
import type { Db } from "../db/client";

const config: Config = {
  botToken: "12345:tok", adminTelegramIds: [111], teamTz: "Europe/Moscow",
  databaseUrl: ":memory:", jwtSecret: "test-secret-16chars-min", publicUrl: "https://x.keenetic.pro",
};
const initDataFor = (id: number) =>
  signInitData({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id, first_name: "T" }) }, config.botToken);
const tokenFor = async (app: ReturnType<typeof createApp>, id: number) =>
  (await (await app.request(new Request("http://x/api/auth", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ initData: initDataFor(id) }),
  }))).json()).token as string;
const bearer = (t: string) => ({ headers: { Authorization: `Bearer ${t}` } });

function worker(db: Db, name: string, tgId: number) {
  const w = createEmployee(db, { displayName: name, inviteToken: `inv-${tgId}` });
  linkTelegramAccount(db, `inv-${tgId}`, tgId);
  return w;
}

describe("GET /api/admin/roster.csv", () => {
  it("returns a BOM-prefixed CSV attachment to an admin", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const res = await app.request(
      "/api/admin/roster.csv?from=2026-06-01&to=2026-06-30",
      bearer(await tokenFor(app, 111)), // allowlisted admin — no employee row needed
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("Content-Disposition")).toMatch(/^attachment; filename="roster-2026-06-01_2026-06-30\.csv"$/);

    // Response#text() decodes as UTF-8 and silently drops a leading BOM (and .trim() would
    // strip it too, since JS treats U+FEFF as whitespace) — inspect the raw bytes instead.
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it("rejects a missing 'from' or 'to' with 400", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const admin = bearer(await tokenFor(app, 111));
    const noFrom = await app.request("/api/admin/roster.csv?to=2026-06-30", admin);
    expect(noFrom.status).toBe(400);
    const noTo = await app.request("/api/admin/roster.csv?from=2026-06-01", admin);
    expect(noTo.status).toBe(400);
  });

  it("forbids a non-admin worker (403)", async () => {
    const db = makeTestDb();
    worker(db, "Игорь", 333);
    const app = createApp({ db, config });
    const res = await app.request(
      "/api/admin/roster.csv?from=2026-06-01&to=2026-06-30",
      bearer(await tokenFor(app, 333)),
    );
    expect(res.status).toBe(403);
  });
});
