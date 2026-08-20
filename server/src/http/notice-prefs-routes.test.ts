import { describe, it, expect } from "vitest";
import { makeTestDb } from "../db/testdb";
import { createEmployee } from "../repo/employees";
import { setNoticeMuted } from "../repo/notice-prefs";
import { issueToken } from "../auth/jwt";
import { createApp } from "./app";

const config = { jwtSecret: "s", teamTz: "Europe/Moscow", publicUrl: "http://x", adminTelegramIds: [] } as any;

async function tokenFor(id: number, isAdmin: boolean) {
  return issueToken({ employeeId: id, isAdmin }, config.jwtSecret);
}

describe("GET/PATCH /api/me/notifications", () => {
  it("отдаёт все виды, выключённый — с enabled:false", async () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня", inviteToken: "i1", isAdmin: true });
    setNoticeMuted(db, anya.id, "swaps", true);
    const app = createApp({ db, config });

    const res = await app.request("/api/me/notifications", {
      headers: { Authorization: `Bearer ${await tokenFor(anya.id, true)}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { kinds: { kind: string; enabled: boolean; title: string }[] };
    expect(body.kinds).toHaveLength(7);
    expect(body.kinds.find((k) => k.kind === "swaps")?.enabled).toBe(false);
    expect(body.kinds.find((k) => k.kind === "weekend")?.enabled).toBe(true);
  });

  it("работнику отвечает 403 — этих писем он не получает вовсе", async () => {
    const db = makeTestDb();
    const marc = createEmployee(db, { displayName: "Марк", inviteToken: "i2" });
    const app = createApp({ db, config });

    const res = await app.request("/api/me/notifications", {
      headers: { Authorization: `Bearer ${await tokenFor(marc.id, false)}` },
    });
    expect(res.status).toBe(403);
  });

  it("PATCH выключает и включает обратно, трогая только себя", async () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня", inviteToken: "i1", isAdmin: true });
    const igor = createEmployee(db, { displayName: "Игорь", inviteToken: "i2", isAdmin: true });
    const app = createApp({ db, config });
    const auth = { Authorization: `Bearer ${await tokenFor(anya.id, true)}`, "Content-Type": "application/json" };

    const off = await app.request("/api/me/notifications", {
      method: "PATCH", headers: auth, body: JSON.stringify({ kind: "weekend", enabled: false }),
    });
    expect(off.status).toBe(200);
    expect(await off.json()).toEqual({ kind: "weekend", enabled: false });

    // Ключевая половина: id берётся из токена, в теле его нет — выключить чужое нечем.
    const igorRes = await app.request("/api/me/notifications", {
      headers: { Authorization: `Bearer ${await tokenFor(igor.id, true)}` },
    });
    const igorBody = (await igorRes.json()) as { kinds: { kind: string; enabled: boolean }[] };
    expect(igorBody.kinds.find((k) => k.kind === "weekend")?.enabled).toBe(true);

    const on = await app.request("/api/me/notifications", {
      method: "PATCH", headers: auth, body: JSON.stringify({ kind: "weekend", enabled: true }),
    });
    expect(await on.json()).toEqual({ kind: "weekend", enabled: true });
  });

  it("несуществующий вид — 400, а не тихо созданная строка", async () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня", inviteToken: "i1", isAdmin: true });
    const app = createApp({ db, config });

    const res = await app.request("/api/me/notifications", {
      method: "PATCH",
      headers: { Authorization: `Bearer ${await tokenFor(anya.id, true)}`, "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "нет-такого", enabled: false }),
    });
    expect(res.status).toBe(400);
  });
});
