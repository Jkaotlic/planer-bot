import { describe, it, expect } from "vitest";
import { createApp } from "./app";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount } from "../repo/employees";
import { createShift } from "../repo/shifts";
import { listActiveTemplates } from "../repo/templates";
import { createChecklistItem, listMarksFor, updateChecklistItem } from "../repo/checklist";
import { readChecklistSettings, saveChecklistDoc, saveChecklistText } from "../repo/checklist-settings";
import { listRecentAudit } from "../repo/audit";
import { signInitData } from "../auth/telegram";
import { testConfig } from "../test-config";
import { shiftTemplates } from "../db/schema";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client";

const config = testConfig();
const initDataFor = (id: number) =>
  signInitData({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id, first_name: "T" }) }, config.botToken);
const tokenFor = async (app: ReturnType<typeof createApp>, id: number) =>
  (await (await app.request(new Request("http://x/api/auth", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ initData: initDataFor(id) }),
  }))).json()).token as string;
const bearer = (t: string) => ({ headers: { Authorization: `Bearer ${t}` } });
const authedJson = (t: string, body: unknown, method = "POST") => ({
  method, headers: { Authorization: `Bearer ${t}`, "content-type": "application/json" }, body: JSON.stringify(body),
});

function worker(db: Db, name: string, tgId: number) {
  const w = createEmployee(db, { displayName: name, inviteToken: `inv-${tgId}` });
  linkTelegramAccount(db, `inv-${tgId}`, tgId);
  return w;
}

/** Помечает пресет как требующий чек-лист — то же, что галочка на «Видах смен». */
function requireChecklistOn(db: Db, templateId: number) {
  db.update(shiftTemplates).set({ requiresChecklist: true }).where(eq(shiftTemplates.id, templateId)).run();
}

describe("чек-лист: пункты (админ)", () => {
  it("новая база отдаёт пустой список — процедуру пишет команда", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);
    const body = await (await app.request("/api/admin/checklist/items", bearer(admin))).json();
    expect(body.items).toEqual([]);
  });

  it("заводит, переименовывает и гасит пункт", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);

    const created = await (await app.request("/api/admin/checklist/items", authedJson(admin, { title: "Проверить свет" }))).json();
    expect(created.item.title).toBe("Проверить свет");

    await app.request(`/api/admin/checklist/items/${created.item.id}`, authedJson(admin, { title: "Проверить освещение" }, "PATCH"));
    let body = await (await app.request("/api/admin/checklist/items", bearer(admin))).json();
    expect(body.items.map((i: { title: string }) => i.title)).toEqual(["Проверить освещение"]);

    await app.request(`/api/admin/checklist/items/${created.item.id}`, { method: "DELETE", ...bearer(admin) });
    body = await (await app.request("/api/admin/checklist/items", bearer(admin))).json();
    expect(body.items).toEqual([]);
  });

  it("работника к пунктам не пускает", async () => {
    const db = makeTestDb();
    worker(db, "Игорь", 333);
    const app = createApp({ db, config });
    const token = await tokenFor(app, 333);
    expect((await app.request("/api/admin/checklist/items", bearer(token))).status).toBe(403);
    expect((await app.request("/api/admin/checklist/items", authedJson(token, { title: "Своё" }))).status).toBe(403);
  });
});

describe("чек-лист: свой (работник)", () => {
  const TODAY = "2026-08-24";

  async function stage() {
    const db = makeTestDb();
    const igor = worker(db, "Игорь", 333);
    const duty = listActiveTemplates(db).find((t) => t.category === "duty")!;
    requireChecklistOn(db, duty.id);
    createShift(db, {
      date: TODAY, start: "07:00", end: "16:00", employeeId: igor.id, category: "duty", templateId: duty.id,
    });
    const app = createApp({ db, config });
    const token = await tokenFor(app, 333);
    return { db, app, token, igor };
  }

  it("молчит, пока в списке нет ни одного пункта", async () => {
    const { app, token } = await stage();
    const body = await (await app.request(`/api/my/checklist?date=${TODAY}`, bearer(token))).json();
    expect(body).toMatchObject({ required: false, items: [] });
  });

  it("отдаёт пункты тому, у кого сегодня отмеченный вид смены", async () => {
    const { db, app, token } = await stage();
    createChecklistItem(db, "Свет");
    createChecklistItem(db, "Окна");
    const body = await (await app.request(`/api/my/checklist?date=${TODAY}`, bearer(token))).json();
    expect(body.required).toBe(true);
    expect(body.items.map((i: { title: string }) => i.title)).toEqual(["Свет", "Окна"]);
    expect(body.markedItemIds).toEqual([]);
  });

  it("не отдаёт чек-лист тому, у кого в этот день его вида смены нет", async () => {
    const { db, app } = await stage();
    createChecklistItem(db, "Свет");
    worker(db, "Аня", 444);
    const other = await tokenFor(app, 444);
    const body = await (await app.request(`/api/my/checklist?date=${TODAY}`, bearer(other))).json();
    expect(body.required).toBe(false);
  });

  it("отмечает и снимает отметку, и повтор ничего не ломает", async () => {
    const { db, app, token, igor } = await stage();
    const item = createChecklistItem(db, "Свет");

    await app.request("/api/my/checklist/mark", authedJson(token, { date: TODAY, itemId: item.id, done: true }));
    await app.request("/api/my/checklist/mark", authedJson(token, { date: TODAY, itemId: item.id, done: true }));
    expect(listMarksFor(db, TODAY, igor.id)).toHaveLength(1);

    await app.request("/api/my/checklist/mark", authedJson(token, { date: TODAY, itemId: item.id, done: false }));
    expect(listMarksFor(db, TODAY, igor.id)).toEqual([]);
  });

  /**
   * Ручка «мой чек-лист» — про СВОЙ: `employeeId` берётся из подписи, а в теле
   * его нет вовсе. Иначе отметить за коллегу мог бы кто угодно.
   */
  it("отметить за коллегу нечем — id в теле не принимается", async () => {
    const { db, app, token, igor } = await stage();
    const item = createChecklistItem(db, "Свет");
    const anya = worker(db, "Аня", 444);

    await app.request("/api/my/checklist/mark", authedJson(token, { date: TODAY, itemId: item.id, done: true, employeeId: anya.id }));
    expect(listMarksFor(db, TODAY, anya.id)).toEqual([]);
    expect(listMarksFor(db, TODAY, igor.id)).toHaveLength(1);
  });

  it("не даёт отметиться тому, кому чек-лист сегодня не положен", async () => {
    const { db, app } = await stage();
    const item = createChecklistItem(db, "Свет");
    worker(db, "Аня", 444);
    const other = await tokenFor(app, 444);
    const res = await app.request("/api/my/checklist/mark", authedJson(other, { date: TODAY, itemId: item.id, done: true }));
    expect(res.status).toBe(400);
  });

  // По строке на каждый тап журнал бы утопило; интересен факт «прошёл».
  it("пишет в журнал одну строку — когда отмечен последний пункт", async () => {
    const { db, app, token } = await stage();
    const first = createChecklistItem(db, "Свет");
    const second = createChecklistItem(db, "Окна");

    await app.request("/api/my/checklist/mark", authedJson(token, { date: TODAY, itemId: first.id, done: true }));
    expect(listRecentAudit(db, 10).map((e) => e.type)).toEqual([]);

    await app.request("/api/my/checklist/mark", authedJson(token, { date: TODAY, itemId: second.id, done: true }));
    const events = listRecentAudit(db, 10);
    expect(events.map((e) => e.type)).toEqual(["checklist_completed"]);
    expect(events[0]!.payload).toMatchObject({ employeeName: "Игорь", date: TODAY, total: 2 });
  });
});

describe("галочка «Требует чек-лист» на виде смены", () => {
  it("приезжает в /templates/roles и переключается", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);
    const duty = listActiveTemplates(db).find((t) => t.category === "duty")!;

    let body = await (await app.request("/api/admin/templates/roles", bearer(admin))).json();
    expect(body.templates.find((t: { templateId: number }) => t.templateId === duty.id).requiresChecklist).toBe(false);

    const res = await app.request(`/api/admin/templates/${duty.id}/checklist`, authedJson(admin, { requiresChecklist: true }, "PUT"));
    expect(res.status).toBe(200);

    body = await (await app.request("/api/admin/templates/roles", bearer(admin))).json();
    expect(body.templates.find((t: { templateId: number }) => t.templateId === duty.id).requiresChecklist).toBe(true);
  });

  it("не пускает работника и не знает несуществующий пресет", async () => {
    const db = makeTestDb();
    worker(db, "Игорь", 333);
    const app = createApp({ db, config });
    const token = await tokenFor(app, 333);
    const admin = await tokenFor(app, 111);
    expect((await app.request("/api/admin/templates/1/checklist", authedJson(token, { requiresChecklist: true }, "PUT"))).status).toBe(403);
    expect((await app.request("/api/admin/templates/9999/checklist", authedJson(admin, { requiresChecklist: true }, "PUT"))).status).toBe(404);
  });
});

describe("чек-лист: инструкция", () => {
  const TODAY = "2026-08-24";

  it("новая база не несёт ни пояснения, ни ссылки, ни файла", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);
    const body = await (await app.request("/api/admin/checklist/settings", bearer(admin))).json();
    expect(body).toEqual({ note: null, docUrl: null, docName: null, hasDoc: false });
  });

  it("сохраняет пояснение и ссылку и стирает их пустым", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);

    let body = await (await app.request("/api/admin/checklist/settings",
      authedJson(admin, { note: "Обходим по часовой", docUrl: "https://disk.example/47.pdf" }, "PUT"))).json();
    expect(body).toMatchObject({ note: "Обходим по часовой", docUrl: "https://disk.example/47.pdf" });

    body = await (await app.request("/api/admin/checklist/settings", authedJson(admin, { note: "", docUrl: "" }, "PUT"))).json();
    expect(body).toMatchObject({ note: null, docUrl: null });
  });

  // `file_id` — ключ к файлу в Telegram. Консоли он не нужен, а наружу отдавать
  // ключи незачем: ей достаточно знать, приложен документ или нет.
  it("не отдаёт наружу telegram-идентификатор файла", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);
    const adminId = (await (await app.request("/api/me", bearer(admin))).json()).id as number;
    saveChecklistDoc(db, { fileId: "BQACAgIAAxSECRET", fileName: "Проверка 47.pdf" }, adminId);

    const res = await app.request("/api/admin/checklist/settings", bearer(admin));
    const raw = await res.text();
    expect(raw).not.toContain("BQACAgIAAxSECRET");
    expect(JSON.parse(raw)).toMatchObject({ docName: "Проверка 47.pdf", hasDoc: true });
  });

  it("снимает приложенный файл", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);
    const adminId = (await (await app.request("/api/me", bearer(admin))).json()).id as number;
    saveChecklistDoc(db, { fileId: "BQACAgIAAx", fileName: "Проверка 47.pdf" }, adminId);

    const body = await (await app.request("/api/admin/checklist/doc", { method: "DELETE", ...bearer(admin) })).json();
    expect(body).toMatchObject({ hasDoc: false, docName: null });
    expect(readChecklistSettings(db).docFileId).toBeNull();
  });

  it("дежурному приезжают пояснение, ссылка и имя файла вместе с пунктами", async () => {
    const db = makeTestDb();
    const igor = worker(db, "Игорь", 333);
    const duty = listActiveTemplates(db).find((t) => t.category === "duty")!;
    requireChecklistOn(db, duty.id);
    createShift(db, { date: TODAY, start: "07:00", end: "16:00", employeeId: igor.id, category: "duty", templateId: duty.id });
    const item = createChecklistItem(db, "Обойти этаж");
    updateChecklistItem(db, item.id, { note: "По часовой, от лифтов" });
    saveChecklistText(db, { note: "Инструкция целиком — в файле", docUrl: "https://disk.example/47.pdf" }, igor.id);
    saveChecklistDoc(db, { fileId: "BQACAgIAAx", fileName: "Проверка 47.pdf" }, igor.id);

    const app = createApp({ db, config });
    const token = await tokenFor(app, 333);
    const body = await (await app.request(`/api/my/checklist?date=${TODAY}`, bearer(token))).json();
    expect(body).toMatchObject({
      required: true,
      note: "Инструкция целиком — в файле",
      docUrl: "https://disk.example/47.pdf",
      docName: "Проверка 47.pdf",
    });
    expect(body.items[0]).toMatchObject({ title: "Обойти этаж", note: "По часовой, от лифтов" });
  });

  // Инструкция — часть чек-листа, и в день, когда он не положен, её тоже нет:
  // иначе экран показывал бы «вот документ дежурного» тому, кто сегодня не дежурит.
  it("не отдаёт инструкцию тому, кому чек-лист сегодня не положен", async () => {
    const db = makeTestDb();
    const igor = worker(db, "Игорь", 333);
    createChecklistItem(db, "Обойти этаж");
    saveChecklistText(db, { note: "Обходим по часовой", docUrl: "https://disk.example/47.pdf" }, igor.id);

    const app = createApp({ db, config });
    const token = await tokenFor(app, 333);
    const body = await (await app.request(`/api/my/checklist?date=${TODAY}`, bearer(token))).json();
    expect(body).toMatchObject({ required: false, note: null, docUrl: null, docName: null });
  });
});
