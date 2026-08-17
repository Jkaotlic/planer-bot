import { describe, it, expect } from "vitest";
import { makeTestDb } from "../db/testdb";
import { createEmployee } from "../repo/employees";
import { submitBugReport } from "../bugs/bug-service";
import { listRecentAudit } from "../repo/audit";
import { issueToken } from "../auth/jwt";
import { createApp } from "./app";

const config = { jwtSecret: "s", teamTz: "Europe/Moscow", publicUrl: "http://x", adminTelegramIds: [] } as any;

async function tokenFor(id: number, isAdmin: boolean) {
  return issueToken({ employeeId: id, isAdmin }, config.jwtSecret);
}

describe("GET/POST /api/admin/bug-reports", () => {
  it("работнику отвечает 403 на обоих маршрутах — текст читает только админ", async () => {
    const db = makeTestDb();
    const marc = createEmployee(db, { displayName: "Марк", inviteToken: "i1" });
    submitBugReport(db, marc.id, "Кнопка не нажимается", new Date("2026-08-17T10:00:00Z"));
    const app = createApp({ db, config });
    const auth = { Authorization: `Bearer ${await tokenFor(marc.id, false)}` };

    const getRes = await app.request("/api/admin/bug-reports?status=open", { headers: auth });
    expect(getRes.status).toBe(403);

    const postRes = await app.request("/api/admin/bug-reports/1/resolve", {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ resolved: true }),
    });
    expect(postRes.status).toBe(403);
  });

  it("status=open прячет разобранные, status=all отдаёт всё", async () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня", inviteToken: "i1", isAdmin: true });
    const marc = createEmployee(db, { displayName: "Марк", inviteToken: "i2" });
    const igor = createEmployee(db, { displayName: "Игорь", inviteToken: "i3" });
    const r1 = submitBugReport(db, marc.id, "Первый баг", new Date("2026-08-17T10:00:00Z"));
    const r2 = submitBugReport(db, igor.id, "Второй баг", new Date("2026-08-17T11:00:00Z"));
    if (!r1.ok || !r2.ok) throw new Error("setup failed");
    const app = createApp({ db, config });
    const auth = { Authorization: `Bearer ${await tokenFor(anya.id, true)}`, "Content-Type": "application/json" };

    await app.request(`/api/admin/bug-reports/${r1.report.id}/resolve`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ resolved: true }),
    });

    const openRes = await app.request("/api/admin/bug-reports?status=open", { headers: auth });
    expect(openRes.status).toBe(200);
    const openBody = (await openRes.json()) as { reports: { id: number; text: string }[] };
    expect(openBody.reports).toHaveLength(1);
    expect(openBody.reports[0].id).toBe(r2.report.id);

    const allRes = await app.request("/api/admin/bug-reports?status=all", { headers: auth });
    const allBody = (await allRes.json()) as {
      reports: { id: number; authorName: string; text: string; createdAt: string; resolvedAt: string | null; resolvedByName: string | null }[];
    };
    expect(allBody.reports).toHaveLength(2);
    // Свежие сверху — сервис уже это гарантирует, маршрут не пересортировывает.
    expect(allBody.reports.map((r) => r.id)).toEqual([r2.report.id, r1.report.id]);
    const resolved = allBody.reports.find((r) => r.id === r1.report.id)!;
    expect(resolved.authorName).toBe("Марк");
    expect(resolved.resolvedAt).not.toBeNull();
    expect(resolved.resolvedByName).toBe("Аня");
  });

  it("невалидный status — 400, а не молчаливый «open»", async () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня", inviteToken: "i1", isAdmin: true });
    const app = createApp({ db, config });
    const res = await app.request("/api/admin/bug-reports?status=нечто", {
      headers: { Authorization: `Bearer ${await tokenFor(anya.id, true)}` },
    });
    expect(res.status).toBe(400);
  });

  it("resolve проставляет отметку и обратим — как «Собрали, закрыть» у сборов", async () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня", inviteToken: "i1", isAdmin: true });
    const marc = createEmployee(db, { displayName: "Марк", inviteToken: "i2" });
    const submitted = submitBugReport(db, marc.id, "Не приходит уведомление", new Date("2026-08-17T10:00:00Z"));
    if (!submitted.ok) throw new Error("setup failed");
    const app = createApp({ db, config });
    const auth = { Authorization: `Bearer ${await tokenFor(anya.id, true)}`, "Content-Type": "application/json" };

    const resolveRes = await app.request(`/api/admin/bug-reports/${submitted.report.id}/resolve`, {
      method: "POST", headers: auth, body: JSON.stringify({ resolved: true }),
    });
    expect(resolveRes.status).toBe(200);
    const resolveBody = (await resolveRes.json()) as { id: number; resolvedAt: string | null };
    expect(resolveBody.id).toBe(submitted.report.id);
    expect(resolveBody.resolvedAt).not.toBeNull();

    const reopenRes = await app.request(`/api/admin/bug-reports/${submitted.report.id}/resolve`, {
      method: "POST", headers: auth, body: JSON.stringify({ resolved: false }),
    });
    expect(reopenRes.status).toBe(200);
    const reopenBody = (await reopenRes.json()) as { id: number; resolvedAt: string | null };
    expect(reopenBody.resolvedAt).toBeNull();

    // Обратимость видна и в списке, не только в ответе на сам вызов.
    const openRes = await app.request("/api/admin/bug-reports?status=open", { headers: auth });
    const openBody = (await openRes.json()) as { reports: { id: number }[] };
    expect(openBody.reports.map((r) => r.id)).toContain(submitted.report.id);
  });

  it("несуществующий id — 404, а не тихий успех", async () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня", inviteToken: "i1", isAdmin: true });
    const app = createApp({ db, config });
    const res = await app.request("/api/admin/bug-reports/99999/resolve", {
      method: "POST",
      headers: { Authorization: `Bearer ${await tokenFor(anya.id, true)}`, "Content-Type": "application/json" },
      body: JSON.stringify({ resolved: true }),
    });
    expect(res.status).toBe(404);
  });

  it("resolved не boolean — 400", async () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня", inviteToken: "i1", isAdmin: true });
    const marc = createEmployee(db, { displayName: "Марк", inviteToken: "i2" });
    const submitted = submitBugReport(db, marc.id, "Баг", new Date("2026-08-17T10:00:00Z"));
    if (!submitted.ok) throw new Error("setup failed");
    const app = createApp({ db, config });
    const res = await app.request(`/api/admin/bug-reports/${submitted.report.id}/resolve`, {
      method: "POST",
      headers: { Authorization: `Bearer ${await tokenFor(anya.id, true)}`, "Content-Type": "application/json" },
      body: JSON.stringify({ resolved: "да" }),
    });
    expect(res.status).toBe(400);
  });

  it("в журнале появляется bug_report_resolved ровно один раз — маршрут не дублирует запись сервиса", async () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня", inviteToken: "i1", isAdmin: true });
    const marc = createEmployee(db, { displayName: "Марк", inviteToken: "i2" });
    const submitted = submitBugReport(db, marc.id, "Баг для журнала", new Date("2026-08-17T10:00:00Z"));
    if (!submitted.ok) throw new Error("setup failed");
    const app = createApp({ db, config });

    await app.request(`/api/admin/bug-reports/${submitted.report.id}/resolve`, {
      method: "POST",
      headers: { Authorization: `Bearer ${await tokenFor(anya.id, true)}`, "Content-Type": "application/json" },
      body: JSON.stringify({ resolved: true }),
    });

    const recent = listRecentAudit(db, 20);
    const resolvedEvents = recent.filter((e) => e.type === "bug_report_resolved");
    expect(resolvedEvents).toHaveLength(1);
    expect(resolvedEvents[0].actorEmployeeId).toBe(anya.id);
  });
});
