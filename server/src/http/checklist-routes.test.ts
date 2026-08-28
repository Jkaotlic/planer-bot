import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { createApp } from "./app";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount, setRemindersEnabled } from "../repo/employees";
import { createShift } from "../repo/shifts";
import { listActiveTemplates } from "../repo/templates";
import { createChecklistItem, listMarksFor, updateChecklistItem } from "../repo/checklist";
import { createChecklist, getChecklist, setTemplateChecklist, updateChecklist } from "../repo/checklists";
import { listRecentAudit } from "../repo/audit";
import { addReminder } from "../repo/reminders";
import { signInitData } from "../auth/telegram";
import { testConfig } from "../test-config";
import { reminderLog, shiftTemplates } from "../db/schema";
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

const TODAY = "2026-08-24";

/** Пресет по имени — тесты говорят «с 07:00», а не «id 6». */
function preset(db: Db, name: string) {
  const found = listActiveTemplates(db).find((t) => t.name === name);
  if (!found) throw new Error(`нет пресета «${name}»`);
  return found;
}

describe("чек-листы (админ)", () => {
  it("новая база не несёт ни одного чек-листа", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);
    expect((await (await app.request("/api/admin/checklists", bearer(admin))).json()).checklists).toEqual([]);
  });

  it("заводит чек-лист, наполняет его и переименовывает", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);

    const created = (await (await app.request("/api/admin/checklists", authedJson(admin, { name: "Дежурство с 07:00" }))).json()).checklist;
    expect(created).toMatchObject({ name: "Дежурство с 07:00", items: [], templateIds: [] });

    const withItem = (await (await app.request(`/api/admin/checklists/${created.id}/items`, authedJson(admin, { title: "Открыть 47-й" }))).json()).checklist;
    expect(withItem.items.map((i: { title: string }) => i.title)).toEqual(["Открыть 47-й"]);

    const renamed = (await (await app.request(`/api/admin/checklists/${created.id}`, authedJson(admin, { name: "Ранний обход" }, "PATCH"))).json()).checklist;
    expect(renamed.name).toBe("Ранний обход");
  });

  /**
   * Ровно то, ради чего правка: у «с семи» и «с восьми» свои списки, и они не
   * пересекаются.
   */
  it("держит два чек-листа, и пункты одного не видны в другом", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);
    const early = createChecklist(db, "С 07:00");
    const late = createChecklist(db, "С 08:00");
    createChecklistItem(db, early.id, "Открыть 47-й");
    createChecklistItem(db, late.id, "Проверить переговорные");

    const body = await (await app.request("/api/admin/checklists", bearer(admin))).json();
    const byName = new Map(body.checklists.map((l: { name: string; items: { title: string }[] }) => [l.name, l.items.map((i) => i.title)]));
    expect(byName.get("С 07:00")).toEqual(["Открыть 47-й"]);
    expect(byName.get("С 08:00")).toEqual(["Проверить переговорные"]);
  });

  it("привязывает чек-лист сразу к нескольким видам смен — это и есть «скоп»", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);
    const list = createChecklist(db, "Ранний обход");
    const early = preset(db, "Дежурство с 07:00");
    const opening = preset(db, "Дежурство · Поклонка");

    const body = await (await app.request(`/api/admin/checklists/${list.id}/templates`,
      authedJson(admin, { templateIds: [early.id, opening.id] }, "PUT"))).json();
    expect(body.checklist.templateIds.sort()).toEqual([early.id, opening.id].sort());
  });

  // Сохранение одного списка не должно молча отвязывать виды смен у соседнего.
  it("правка привязок одного чек-листа не трогает чужие", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);
    const early = createChecklist(db, "С 07:00");
    const late = createChecklist(db, "С 08:00");
    const earlyPreset = preset(db, "Дежурство с 07:00");
    const morning = preset(db, "Утро");
    setTemplateChecklist(db, morning.id, late.id);

    await app.request(`/api/admin/checklists/${early.id}/templates`, authedJson(admin, { templateIds: [earlyPreset.id] }, "PUT"));

    const templates = listActiveTemplates(db);
    expect(templates.find((t) => t.id === morning.id)!.checklistId).toBe(late.id);
    expect(templates.find((t) => t.id === earlyPreset.id)!.checklistId).toBe(early.id);
  });

  it("удаление чек-листа снимает привязку у видов смен", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);
    const list = createChecklist(db, "Обход");
    const early = preset(db, "Дежурство с 07:00");
    setTemplateChecklist(db, early.id, list.id);

    await app.request(`/api/admin/checklists/${list.id}`, { method: "DELETE", ...bearer(admin) });
    expect(listActiveTemplates(db).find((t) => t.id === early.id)!.checklistId).toBeNull();
  });

  // `file_id` — ключ к файлу в Telegram. Консоли он не нужен, а наружу отдавать
  // ключи незачем: ей достаточно знать, приложен документ или нет.
  it("не отдаёт наружу telegram-идентификатор файла", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);
    const list = createChecklist(db, "Обход");
    updateChecklist(db, list.id, { docFileId: "BQACAgIAAxSECRET", docName: "Проверка 47.pdf" });

    const raw = await (await app.request("/api/admin/checklists", bearer(admin))).text();
    expect(raw).not.toContain("BQACAgIAAxSECRET");
    expect(JSON.parse(raw).checklists[0]).toMatchObject({ docName: "Проверка 47.pdf", hasDoc: true });
  });

  it("работника к чек-листам не пускает", async () => {
    const db = makeTestDb();
    worker(db, "Игорь", 333);
    const app = createApp({ db, config });
    const token = await tokenFor(app, 333);
    expect((await app.request("/api/admin/checklists", bearer(token))).status).toBe(403);
    expect((await app.request("/api/admin/checklists", authedJson(token, { name: "Своё" }))).status).toBe(403);
  });
});

describe("чек-лист: свой (работник)", () => {
  /** Игорь дежурит с 07:00, Аня выходит в «Утро» с 08:00 — у каждого свой список. */
  async function stage() {
    const db = makeTestDb();
    const igor = worker(db, "Игорь", 333);
    const anya = worker(db, "Аня", 444);
    const early = createChecklist(db, "С 07:00");
    const late = createChecklist(db, "С 08:00");
    createChecklistItem(db, early.id, "Открыть 47-й");
    createChecklistItem(db, late.id, "Проверить переговорные");

    const earlyPreset = preset(db, "Дежурство с 07:00");
    const morning = preset(db, "Утро");
    setTemplateChecklist(db, earlyPreset.id, early.id);
    setTemplateChecklist(db, morning.id, late.id);
    const igorShift = createShift(db, { date: TODAY, start: "07:00", end: "16:00", employeeId: igor.id, category: "duty", templateId: earlyPreset.id });
    createShift(db, { date: TODAY, start: "08:00", end: "17:00", employeeId: anya.id, category: "shift", templateId: morning.id });

    const app = createApp({ db, config });
    return { db, app, igor, anya, early, late, earlyPreset, morning, igorShift };
  }

  it("каждому приезжает чек-лист его вида смены, и только он", async () => {
    const { app } = await stage();
    const igorBody = await (await app.request(`/api/my/checklist?date=${TODAY}`, bearer(await tokenFor(app, 333)))).json();
    const anyaBody = await (await app.request(`/api/my/checklist?date=${TODAY}`, bearer(await tokenFor(app, 444)))).json();

    expect(igorBody.checklists.map((l: { name: string }) => l.name)).toEqual(["С 07:00"]);
    expect(igorBody.checklists[0].items.map((i: { title: string }) => i.title)).toEqual(["Открыть 47-й"]);
    expect(anyaBody.checklists.map((l: { name: string }) => l.name)).toEqual(["С 08:00"]);
  });

  it("у кого сегодня нет такой смены — ни одного чек-листа", async () => {
    const { db, app } = await stage();
    worker(db, "Марк", 555);
    const body = await (await app.request(`/api/my/checklist?date=${TODAY}`, bearer(await tokenFor(app, 555)))).json();
    expect(body.checklists).toEqual([]);
  });

  it("пустой чек-лист не показывается вовсе — проходить нечего", async () => {
    const { db, app, igor, earlyPreset } = await stage();
    const empty = createChecklist(db, "Пустой");
    setTemplateChecklist(db, earlyPreset.id, empty.id);
    expect(igor.id).toBeGreaterThan(0);
    const body = await (await app.request(`/api/my/checklist?date=${TODAY}`, bearer(await tokenFor(app, 333)))).json();
    expect(body.checklists).toEqual([]);
  });

  it("отмечает и снимает отметку, и повтор ничего не ломает", async () => {
    const { db, app, igor, early } = await stage();
    const token = await tokenFor(app, 333);
    const itemId = (await (await app.request(`/api/my/checklist?date=${TODAY}`, bearer(token))).json()).checklists[0].items[0].id;
    expect(early.id).toBeGreaterThan(0);

    await app.request("/api/my/checklist/mark", authedJson(token, { date: TODAY, itemId, done: true }));
    await app.request("/api/my/checklist/mark", authedJson(token, { date: TODAY, itemId, done: true }));
    expect(listMarksFor(db, TODAY, igor.id)).toHaveLength(1);

    await app.request("/api/my/checklist/mark", authedJson(token, { date: TODAY, itemId, done: false }));
    expect(listMarksFor(db, TODAY, igor.id)).toEqual([]);
  });

  /**
   * Дежурный с восьми не должен закрывать проверки того, кто выходит в семь:
   * пункт чужого чек-листа — это чужая работа, а не общая.
   */
  it("не даёт отметить пункт чужого чек-листа", async () => {
    const { db, app, late } = await stage();
    const foreignItem = createChecklistItem(db, late.id, "Ещё пункт");
    const igorToken = await tokenFor(app, 333);
    const res = await app.request("/api/my/checklist/mark", authedJson(igorToken, { date: TODAY, itemId: foreignItem.id, done: true }));
    expect(res.status).toBe(400);
  });

  it("id в теле не даёт отметиться за коллегу", async () => {
    const { db, app, igor, anya } = await stage();
    const token = await tokenFor(app, 333);
    const itemId = (await (await app.request(`/api/my/checklist?date=${TODAY}`, bearer(token))).json()).checklists[0].items[0].id;
    await app.request("/api/my/checklist/mark", authedJson(token, { date: TODAY, itemId, done: true, employeeId: anya.id }));
    expect(listMarksFor(db, TODAY, anya.id)).toEqual([]);
    expect(listMarksFor(db, TODAY, igor.id)).toHaveLength(1);
  });

  it("пишет в журнал одну строку — когда отмечен последний пункт своего списка", async () => {
    const { db, app, early } = await stage();
    createChecklistItem(db, early.id, "Второй пункт");
    const token = await tokenFor(app, 333);
    const items = (await (await app.request(`/api/my/checklist?date=${TODAY}`, bearer(token))).json()).checklists[0].items;

    await app.request("/api/my/checklist/mark", authedJson(token, { date: TODAY, itemId: items[0].id, done: true }));
    expect(listRecentAudit(db, 10).map((e) => e.type)).toEqual([]);

    await app.request("/api/my/checklist/mark", authedJson(token, { date: TODAY, itemId: items[1].id, done: true }));
    const events = listRecentAudit(db, 10);
    expect(events.map((e) => e.type)).toEqual(["checklist_completed"]);
    expect(events[0]!.payload).toMatchObject({ employeeName: "Игорь", date: TODAY, checklistName: "С 07:00", total: 2 });
  });

  it("инструкция приезжает вместе с пунктами", async () => {
    const { db, app, early } = await stage();
    updateChecklist(db, early.id, { note: "Начинаем от лифтов", docUrl: "https://disk.example/47.pdf" });
    updateChecklist(db, early.id, { docFileId: "BQACAgIAAx", docName: "Проверка 47.pdf" });
    const item = createChecklistItem(db, early.id, "Записать замечания");
    updateChecklistItem(db, item.id, { note: "В журнал на посту" });

    const body = await (await app.request(`/api/my/checklist?date=${TODAY}`, bearer(await tokenFor(app, 333)))).json();
    expect(body.checklists[0]).toMatchObject({
      note: "Начинаем от лифтов",
      docUrl: "https://disk.example/47.pdf",
      docName: "Проверка 47.pdf",
    });
    expect(body.checklists[0].items[1]).toMatchObject({ title: "Записать замечания", note: "В журнал на посту" });
  });

  it("сводка дня называет каждому его чек-лист", async () => {
    const { app } = await stage();
    const admin = await tokenFor(app, 111);
    const body = await (await app.request(`/api/admin/checklist/day?date=${TODAY}`, bearer(admin))).json();
    const byName = new Map(body.people.map((p: { displayName: string; checklistName: string }) => [p.displayName, p.checklistName]));
    expect(byName.get("Игорь")).toBe("С 07:00");
    expect(byName.get("Аня")).toBe("С 08:00");
  });

  /**
   * Ровно та непонятность, ради которой правка: «придёт ли дежурному сообщение
   * и когда» админ не мог узнать нигде — ни на экране, ни в сводке.
   */
  it("сводка дня говорит, во сколько уйдёт сообщение и уйдёт ли", async () => {
    const { app } = await stage();
    const admin = await tokenFor(app, 111);
    const body = await (await app.request(`/api/admin/checklist/day?date=${TODAY}`, bearer(admin))).json();
    const byName = new Map(body.people.map((p: { displayName: string }) => [p.displayName, p]));
    expect(byName.get("Игорь")).toMatchObject({ start: "07:00", delivery: "scheduled" });
    expect(byName.get("Аня")).toMatchObject({ start: "08:00", delivery: "scheduled" });
  });

  it("отправленное сегодня помечено отправленным и называет час", async () => {
    const { db, app, igorShift } = await stage();
    addReminder(db, igorShift.id, "duty_checklist");
    // 2026-08-28 07:02 по Москве — час, в который тик и шлёт утренним дежурным.
    db.update(reminderLog).set({ sentAt: new Date(1787889727 * 1000) }).where(eq(reminderLog.shiftId, igorShift.id)).run();
    const admin = await tokenFor(app, 111);
    const body = await (await app.request(`/api/admin/checklist/day?date=${TODAY}`, bearer(admin))).json();
    const igorRow = body.people.find((p: { displayName: string }) => p.displayName === "Игорь");
    expect(igorRow.delivery).toBe("sent");
    // Час — по поясу команды, а не по поясу машины: `TEAM_TZ` тестов — Москва.
    expect(igorRow.sentAt).toBe("07:02");
  });

  it("у неотправленного часа нет", async () => {
    const { app } = await stage();
    const admin = await tokenFor(app, 111);
    const body = await (await app.request(`/api/admin/checklist/day?date=${TODAY}`, bearer(admin))).json();
    expect(body.people.find((p: { displayName: string }) => p.displayName === "Игорь").sentAt).toBeNull();
  });

  /**
   * Личная галочка «не пиши мне про смены» чек-лист не глушит: это рабочая
   * инструкция. До 2026-08-28 глушила, и трое остались без неё на месяц.
   */
  it("выключенные напоминания чек-лист не отменяют", async () => {
    const { db, app, igor } = await stage();
    setRemindersEnabled(db, igor.id, false);
    const admin = await tokenFor(app, 111);
    const body = await (await app.request(`/api/admin/checklist/day?date=${TODAY}`, bearer(admin))).json();
    expect(body.people.find((p: { displayName: string }) => p.displayName === "Игорь").delivery).toBe("scheduled");
  });

  it("непривязанный к Telegram виден в сводке", async () => {
    const { db, app, earlyPreset } = await stage();
    const mark = createEmployee(db, { displayName: "Марк", inviteToken: "inv-mark" });
    createShift(db, { date: TODAY, start: "07:00", end: "16:00", employeeId: mark.id, category: "duty", templateId: earlyPreset.id });
    const admin = await tokenFor(app, 111);
    const body = await (await app.request(`/api/admin/checklist/day?date=${TODAY}`, bearer(admin))).json();
    expect(body.people.find((p: { displayName: string }) => p.displayName === "Марк").delivery).toBe("no-telegram");
  });

  it("список без пунктов, пояснения и файла не уйдёт никому", async () => {
    const { db, app, earlyPreset } = await stage();
    const empty = createChecklist(db, "Пустой");
    setTemplateChecklist(db, earlyPreset.id, empty.id);
    const admin = await tokenFor(app, 111);
    const body = await (await app.request(`/api/admin/checklist/day?date=${TODAY}`, bearer(admin))).json();
    expect(body.people.find((p: { displayName: string }) => p.displayName === "Игорь").delivery).toBe("nothing-to-send");
  });

  // Пунктов нет, а пояснение есть — сообщение уходит: это и есть случай
  // «Дежурств 47» (2026-08-26), из-за которого условие непустоты сняли.
  it("список с одним пояснением уйдёт", async () => {
    const { db, app, earlyPreset } = await stage();
    const noted = createChecklist(db, "Только пояснение");
    updateChecklist(db, noted.id, { note: "Обход от лифтов, по часовой" });
    setTemplateChecklist(db, earlyPreset.id, noted.id);
    const admin = await tokenFor(app, 111);
    const body = await (await app.request(`/api/admin/checklist/day?date=${TODAY}`, bearer(admin))).json();
    expect(body.people.find((p: { displayName: string }) => p.displayName === "Игорь").delivery).toBe("scheduled");
  });
});

describe("привязка чек-листа к виду смены", () => {
  it("приезжает в /templates/roles и переключается", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);
    const list = createChecklist(db, "Ранний обход");
    const early = preset(db, "Дежурство с 07:00");

    let body = await (await app.request("/api/admin/templates/roles", bearer(admin))).json();
    expect(body.templates.find((t: { templateId: number }) => t.templateId === early.id).checklistId).toBeNull();

    const res = await app.request(`/api/admin/templates/${early.id}/checklist`, authedJson(admin, { checklistId: list.id }, "PUT"));
    expect(res.status).toBe(200);

    body = await (await app.request("/api/admin/templates/roles", bearer(admin))).json();
    expect(body.templates.find((t: { templateId: number }) => t.templateId === early.id).checklistId).toBe(list.id);
  });

  it("снимается через null", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);
    const list = createChecklist(db, "Ранний обход");
    const early = preset(db, "Дежурство с 07:00");
    db.update(shiftTemplates).set({ checklistId: list.id }).where(eq(shiftTemplates.id, early.id)).run();

    await app.request(`/api/admin/templates/${early.id}/checklist`, authedJson(admin, { checklistId: null }, "PUT"));
    expect(listActiveTemplates(db).find((t) => t.id === early.id)!.checklistId).toBeNull();
  });

  it("не знает несуществующий чек-лист и несуществующий пресет", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);
    const early = preset(db, "Дежурство с 07:00");
    expect((await app.request(`/api/admin/templates/${early.id}/checklist`, authedJson(admin, { checklistId: 9999 }, "PUT"))).status).toBe(400);
    expect((await app.request("/api/admin/templates/9999/checklist", authedJson(admin, { checklistId: null }, "PUT"))).status).toBe(404);
    expect(getChecklist(db, 9999)).toBeUndefined();
  });

  it("не пускает работника", async () => {
    const db = makeTestDb();
    worker(db, "Игорь", 333);
    const app = createApp({ db, config });
    const token = await tokenFor(app, 333);
    expect((await app.request("/api/admin/templates/1/checklist", authedJson(token, { checklistId: null }, "PUT"))).status).toBe(403);
  });
});
