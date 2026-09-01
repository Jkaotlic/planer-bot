import { describe, it, expect, vi } from "vitest";
import type { Bot } from "grammy";
import { createApp } from "./app";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount, archiveEmployee } from "../repo/employees";
import { listActiveTemplates } from "../repo/templates";
import { createShift, listShiftsInRange, getShift } from "../repo/shifts";
import { listRecentAudit } from "../repo/audit";
import { NOTICE_WINDOW_MS } from "../schedule/notice-buffer";
import { signInitData } from "../auth/telegram";
import { testConfig } from "../test-config";

/**
 * «Расставить с какого по какое» (его пункт 6 от 2026-08-21).
 *
 * The point of the route is that a range of work is N one-day entries, not one
 * row carrying `endDate`: `entryDateError` forbids the latter on purpose,
 * because a shift with a span draws into every day of it while the balance and
 * the report count it once.
 */
function fakeBot() {
  const sent: { to: number; text: string }[] = [];
  const bot = { api: { sendMessage: vi.fn(async (to: number, text: string) => { sent.push({ to, text }); }) } };
  return { bot: bot as unknown as Bot, sent };
}

const config = testConfig();
const initDataFor = (id: number) =>
  signInitData({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id, first_name: "T" }) }, config.botToken);
const tokenFor = async (app: ReturnType<typeof createApp>, id: number) =>
  (await (await app.request(new Request("http://x/api/auth", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ initData: initDataFor(id) }),
  }))).json()).token as string;
const authedJson = (t: string, body: unknown, method = "POST") => ({
  method, headers: { Authorization: `Bearer ${t}`, "content-type": "application/json" }, body: JSON.stringify(body),
});

// 2026-08-24 — понедельник; 29-е и 30-е — суббота и воскресенье.
const MON = "2026-08-24";
const SUN = "2026-08-30";

describe("POST /api/admin/entries/range", () => {
  it("создаёт по записи на каждый будний день, а не одну с endDate", async () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня" });
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);

    const res = await app.request("/api/admin/entries/range", authedJson(admin, {
      employeeId: anya.id, from: MON, to: SUN, category: "shift", start: "09:00", end: "18:00", title: "День",
    }));

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.created).toHaveLength(5);
    expect(body.skipped.map((s: { reason: string }) => s.reason)).toEqual(["weekend", "weekend"]);

    const rows = listShiftsInRange(db, MON, SUN);
    expect(rows).toHaveLength(5);
    // Ни одна не диапазонная — иначе баланс считал бы одну смену вместо пяти.
    expect(rows.every((r) => r.endDate === null)).toBe(true);
    expect(rows.map((r) => r.date)).toEqual([
      "2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28",
    ]);
  });

  it("с поднятым флагом берёт и выходные", async () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня" });
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);

    await app.request("/api/admin/entries/range", authedJson(admin, {
      employeeId: anya.id, from: MON, to: SUN, category: "shift", start: "09:00", end: "18:00",
      includeWeekends: true,
    }));
    expect(listShiftsInRange(db, MON, SUN)).toHaveLength(7);
  });

  it("занятый день пропускает, а не кладёт вторую смену поверх первой", async () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня" });
    createShift(db, { date: "2026-08-25", start: "09:00", end: "18:00", employeeId: anya.id, category: "shift" });
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);

    const body = await (await app.request("/api/admin/entries/range", authedJson(admin, {
      employeeId: anya.id, from: MON, to: "2026-08-26", category: "shift", start: "08:00", end: "17:00",
    }))).json();

    expect(body.created).toHaveLength(2);
    expect(body.skipped).toEqual([{ date: "2026-08-25", reason: "busy" }]);
    // Прежняя запись не тронута: 09:00, а не 08:00.
    expect(listShiftsInRange(db, "2026-08-25", "2026-08-25")[0]!.start).toBe("09:00");
  });

  // Отсутствие в базе живёт полосой, а не набором клеток: тридцать строк вместо
  // одной сломали бы и сетку, и журнал.
  it("отпуск пишет одной записью с endDate", async () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня" });
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);

    const body = await (await app.request("/api/admin/entries/range", authedJson(admin, {
      employeeId: anya.id, from: MON, to: SUN, category: "vacation",
    }))).json();

    expect(body.created).toHaveLength(1);
    expect(body.created[0]).toMatchObject({ date: MON, endDate: SUN, category: "vacation", start: null, end: null });
  });

  it("«Работа в выходной» берёт только субботу и воскресенье", async () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня" });
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);

    const body = await (await app.request("/api/admin/entries/range", authedJson(admin, {
      employeeId: anya.id, from: MON, to: SUN, category: "weekend_work", start: "10:00", end: "16:00",
      includeWeekends: true,
    }))).json();

    expect(body.created.map((e: { date: string }) => e.date)).toEqual(["2026-08-29", "2026-08-30"]);
  });

  // Тридцать `entry_created` подряд сделали бы журнал и ленту нечитаемыми.
  it("оставляет в журнале одну строку на всю расстановку", async () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня" });
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);

    await app.request("/api/admin/entries/range", authedJson(admin, {
      employeeId: anya.id, from: MON, to: SUN, category: "shift", start: "09:00", end: "18:00", title: "День",
    }));

    const events = listRecentAudit(db, 20);
    expect(events.map((e) => e.type)).toEqual(["entries_range_created"]);
    expect(events[0]!.payload).toMatchObject({ employeeName: "Аня", from: MON, to: SUN, created: 5, skipped: 2 });
  });

  // Ради этого noticeBuffer и написан: пять писем за 24 секунды — тот самый
  // инцидент, из которого он вырос.
  it("шлёт работнику одно письмо на всю расстановку, а не по письму на день", async () => {
    vi.useFakeTimers();
    try {
      const db = makeTestDb();
      const anya = createEmployee(db, { displayName: "Аня", inviteToken: "inv-anya" });
      linkTelegramAccount(db, "inv-anya", 555);
      const { bot, sent } = fakeBot();
      const app = createApp({ db, config, bot });
      const admin = await tokenFor(app, 111);

      await app.request("/api/admin/entries/range", authedJson(admin, {
        employeeId: anya.id, from: "2099-01-05", to: "2099-01-09", category: "shift", start: "09:00", end: "18:00",
      }));

      await vi.advanceTimersByTimeAsync(NOTICE_WINDOW_MS + 100);
      expect(sent.filter((m) => m.to === 555)).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("отказывает на диапазоне длиннее года", async () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня" });
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);

    const res = await app.request("/api/admin/entries/range", authedJson(admin, {
      employeeId: anya.id, from: "2026-01-01", to: "2027-06-01", category: "shift", start: "09:00", end: "18:00",
    }));
    expect(res.status).toBe(400);
    expect(listShiftsInRange(db, "2026-01-01", "2027-06-01")).toHaveLength(0);
  });

  it("отказывает на архивном работнике и ничего не создаёт", async () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня" });
    archiveEmployee(db, anya.id, MON);
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);

    const res = await app.request("/api/admin/entries/range", authedJson(admin, {
      employeeId: anya.id, from: MON, to: SUN, category: "shift", start: "09:00", end: "18:00",
    }));
    expect(res.status).toBe(400);
    expect(listShiftsInRange(db, MON, SUN)).toHaveLength(0);
  });

  it("не пускает не-админа", async () => {
    const db = makeTestDb();
    const igor = createEmployee(db, { displayName: "Игорь", inviteToken: "inv-333" });
    linkTelegramAccount(db, "inv-333", 333);
    const app = createApp({ db, config });
    const worker = await tokenFor(app, 333);

    const res = await app.request("/api/admin/entries/range", authedJson(worker, {
      employeeId: igor.id, from: MON, to: SUN, category: "shift", start: "09:00", end: "18:00",
    }));
    expect(res.status).toBe(403);
  });

  // Пятница у пресета своя, и диапазон обязан это знать: смена, растянутая на
  // неделю одними и теми же часами, ставит в пятницу 18:00 вместо 16:45 — то
  // самое сокращение, ради которого пятничные часы в пресете и заведены.
  it("в пятницу берёт пятничные часы пресета, а не общие", async () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня" });
    // Пресеты заводит миграция, а не тест: у «Дня» пятничные часы 09:00–16:45.
    const tpl = listActiveTemplates(db).find((t) => t.name === "День")!;
    expect(tpl.fridayEnd).toBe("16:45");
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);

    await app.request("/api/admin/entries/range", authedJson(admin, {
      employeeId: anya.id, from: MON, to: "2026-08-28", category: "shift",
      templateId: tpl.id, start: "09:00", end: "18:00", title: "День",
    }));

    const rows = listShiftsInRange(db, MON, "2026-08-28");
    // 2026-08-28 — пятница.
    expect(rows.find((r) => r.date === "2026-08-28")).toMatchObject({ start: "09:00", end: "16:45" });
    expect(rows.find((r) => r.date === "2026-08-27")).toMatchObject({ start: "09:00", end: "18:00" });
  });
});

/**
 * `mode: "rewrite"` — «сделай так на всём отрезке».
 *
 * Отличается от расстановки ровно одним: занятый рабочий день не пропускается, а
 * переписывается НА МЕСТЕ. Именно на месте, а не сносом и созданием заново: на
 * `shifts.id` висят напоминания (уникальный индекс `reminder_shift_kind`) и
 * заявки на обмен, и снос порвал бы обе связи ради результата, который выглядит
 * так же.
 */
describe("POST /api/admin/entries/range · mode=rewrite", () => {
  it("переписывает занятый день на месте, сохраняя запись и её id", async () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня" });
    const was = createShift(db, { date: "2026-08-25", start: "09:00", end: "18:00", employeeId: anya.id, category: "shift" });
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);

    const res = await app.request("/api/admin/entries/range", authedJson(admin, {
      employeeId: anya.id, from: MON, to: "2026-08-26", category: "duty", start: "10:00", end: "19:00",
      title: "Вавилова", mode: "rewrite",
    }));

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.created.map((e: { date: string }) => e.date)).toEqual([MON, "2026-08-26"]);
    expect(body.updated.map((e: { date: string }) => e.date)).toEqual(["2026-08-25"]);
    expect(getShift(db, was.id)).toMatchObject({ category: "duty", start: "10:00", end: "19:00", title: "Вавилова" });
  });

  // Пресет — это цвет клетки и код в выгрузке. Смена «Утро», переписанная в
  // дежурство, осталась бы цвета «Утро» и вернулась бы сменой через круг в Excel:
  // тот же дефект, что уже чинили в правке одной записи.
  it("не оставляет на переписанной записи пресет и подпись прежней", async () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня" });
    const tpl = listActiveTemplates(db).find((t) => t.name === "День")!;
    const was = createShift(db, {
      date: "2026-08-25", start: "09:00", end: "18:00", employeeId: anya.id, category: "shift",
      templateId: tpl.id, title: "День", location: "Поклонка",
    });
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);

    await app.request("/api/admin/entries/range", authedJson(admin, {
      employeeId: anya.id, from: "2026-08-25", to: "2026-08-25", category: "duty",
      start: "10:00", end: "19:00", title: "Вавилова", mode: "rewrite",
    }));

    expect(getShift(db, was.id)).toMatchObject({ templateId: null, title: "Вавилова", location: null });
  });

  // `unrecognisedCode` — «импорт не смог прочитать эту клетку», и каждый читатель
  // ставит его выше всего: выгрузка пишет обратно исходный текст, отчёт кладёт
  // запись в «не распознано», обе сетки рисуют «?». Перезапись НАЗЫВАЕТ запись
  // целиком, то есть клетку прочитал человек — метка уходит вместе с прежними
  // полями. Тот же довод, что у правки одной записи.
  it("снимает с переписанной записи метку «импорт не прочитал»", async () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня" });
    const was = createShift(db, {
      date: "2026-08-25", start: "09:00", end: "18:00", employeeId: anya.id, category: "shift",
      unrecognisedCode: "Ко",
    });
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);

    await app.request("/api/admin/entries/range", authedJson(admin, {
      employeeId: anya.id, from: "2026-08-25", to: "2026-08-25", category: "duty",
      start: "10:00", end: "19:00", mode: "rewrite",
    }));

    expect(getShift(db, was.id)).toMatchObject({ category: "duty", unrecognisedCode: null });
  });

  it("отпуск не трогает и называет причину", async () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня" });
    const otpusk = createShift(db, { date: "2026-08-25", endDate: "2026-08-26", employeeId: anya.id, category: "vacation" });
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);

    const body = await (await app.request("/api/admin/entries/range", authedJson(admin, {
      employeeId: anya.id, from: MON, to: "2026-08-26", category: "duty", start: "10:00", end: "19:00", mode: "rewrite",
    }))).json();

    expect(body.skipped).toEqual([
      { date: "2026-08-25", reason: "absence" },
      { date: "2026-08-26", reason: "absence" },
    ]);
    expect(getShift(db, otpusk.id)).toMatchObject({ category: "vacation", endDate: "2026-08-26" });
  });

  // Уникального индекса на (работник, день) в таблице нет, и импорт ростера такие
  // дни создаёт. Догадка «перепишем первую» стёрла бы вторую молча.
  it("день с двумя записями пропускает, а не выбирает одну из них", async () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня" });
    createShift(db, { date: "2026-08-25", start: "09:00", end: "13:00", employeeId: anya.id, category: "shift" });
    createShift(db, { date: "2026-08-25", start: "14:00", end: "18:00", employeeId: anya.id, category: "duty" });
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);

    const body = await (await app.request("/api/admin/entries/range", authedJson(admin, {
      employeeId: anya.id, from: "2026-08-25", to: "2026-08-25", category: "duty", start: "10:00", end: "19:00", mode: "rewrite",
    }))).json();

    expect(body.skipped).toEqual([{ date: "2026-08-25", reason: "ambiguous" }]);
    expect(listShiftsInRange(db, "2026-08-25", "2026-08-25")).toHaveLength(2);
  });

  it("чужие записи в этих днях не трогает", async () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня" });
    const igor = createEmployee(db, { displayName: "Игорь" });
    const his = createShift(db, { date: "2026-08-25", start: "09:00", end: "18:00", employeeId: igor.id, category: "shift" });
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);

    await app.request("/api/admin/entries/range", authedJson(admin, {
      employeeId: anya.id, from: "2026-08-25", to: "2026-08-25", category: "duty", start: "10:00", end: "19:00", mode: "rewrite",
    }));

    expect(getShift(db, his.id)).toMatchObject({ employeeId: igor.id, category: "shift", start: "09:00" });
  });

  it("в пятницу берёт пятничные часы пресета и при перезаписи", async () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня" });
    const tpl = listActiveTemplates(db).find((t) => t.name === "День")!;
    createShift(db, { date: "2026-08-28", start: "12:00", end: "20:00", employeeId: anya.id, category: "duty" });
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);

    await app.request("/api/admin/entries/range", authedJson(admin, {
      employeeId: anya.id, from: "2026-08-27", to: "2026-08-28", category: "shift",
      templateId: tpl.id, start: "09:00", end: "18:00", title: "День", mode: "rewrite",
    }));

    const rows = listShiftsInRange(db, "2026-08-27", "2026-08-28");
    expect(rows.find((r) => r.date === "2026-08-28")).toMatchObject({ start: "09:00", end: "16:45" });
  });

  // Перезапись и расстановка — разные события: «Расставлено диапазоном» про
  // неделю, где четыре смены заменены, соврало бы ленте, которую команда читает
  // как историю своего графика.
  it("оставляет в журнале одну строку, и она про перезапись", async () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня" });
    createShift(db, { date: "2026-08-25", start: "09:00", end: "18:00", employeeId: anya.id, category: "shift" });
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);

    await app.request("/api/admin/entries/range", authedJson(admin, {
      employeeId: anya.id, from: MON, to: "2026-08-26", category: "duty", start: "10:00", end: "19:00", mode: "rewrite",
    }));

    const events = listRecentAudit(db, 20);
    expect(events.map((e) => e.type)).toEqual(["entries_range_rewritten"]);
    expect(events[0]!.payload).toMatchObject({ employeeName: "Аня", from: MON, to: "2026-08-26", created: 2, updated: 1, skipped: 0 });
  });

  it("шлёт работнику одно письмо на всю перезапись", async () => {
    vi.useFakeTimers();
    try {
      const db = makeTestDb();
      const anya = createEmployee(db, { displayName: "Аня", inviteToken: "inv-anya" });
      linkTelegramAccount(db, "inv-anya", 555);
      for (const date of ["2099-01-05", "2099-01-06", "2099-01-07"]) {
        createShift(db, { date, start: "09:00", end: "18:00", employeeId: anya.id, category: "shift" });
      }
      const { bot, sent } = fakeBot();
      const app = createApp({ db, config, bot });
      const admin = await tokenFor(app, 111);

      await app.request("/api/admin/entries/range", authedJson(admin, {
        employeeId: anya.id, from: "2099-01-05", to: "2099-01-08", category: "duty",
        start: "10:00", end: "19:00", mode: "rewrite",
      }));

      await vi.advanceTimersByTimeAsync(NOTICE_WINDOW_MS + 100);
      expect(sent.filter((m) => m.to === 555)).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  // Старые клиенты тела без `mode` уже шлют, и молча получить перезапись вместо
  // расстановки — худшее, чем может кончиться эта правка.
  it("без mode ведёт себя как расстановка: занятый день пропущен", async () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня" });
    createShift(db, { date: "2026-08-25", start: "09:00", end: "18:00", employeeId: anya.id, category: "shift" });
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);

    const body = await (await app.request("/api/admin/entries/range", authedJson(admin, {
      employeeId: anya.id, from: MON, to: "2026-08-26", category: "duty", start: "10:00", end: "19:00",
    }))).json();

    expect(body.skipped).toEqual([{ date: "2026-08-25", reason: "busy" }]);
    expect(listShiftsInRange(db, "2026-08-25", "2026-08-25")[0]).toMatchObject({ category: "shift" });
  });
});
