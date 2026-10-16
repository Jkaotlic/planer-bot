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
// createSwap отказывает смене в прошлом («from-shift-in-past»), а этот файл
// живёт годами на фиксированных датах 2026-08-*, поэтому тестам про обмен
// нужна настоящая будущая дата, а не литерал.
const daysFromNow = (n: number): string => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return new Intl.DateTimeFormat("en-CA", { timeZone: config.teamTz }).format(d);
};

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

  // Та же дыра, что чинили у одиночной PATCH (2026-09-25, ledger «Смена,
  // сменившая вид»): перезапись отрезком может превратить смену в дежурство
  // с другими часами не хуже одиночной правки, и висящий на ней обмен должен
  // гаснуть тем же способом — иначе Аня и Игорь соглашались на одну смену, а
  // получили бы другую, и ни один не узнал бы.
  it("перезапись диапазоном, сменившая вид записи, гасит висящий на ней обмен и шлёт обоим", async () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня", inviteToken: "inv-anya-r" });
    const igor = createEmployee(db, { displayName: "Игорь", inviteToken: "inv-igor-r" });
    linkTelegramAccount(db, "inv-anya-r", 811);
    linkTelegramAccount(db, "inv-igor-r", 812);
    const sa = createShift(db, { date: daysFromNow(30), start: "08:00", end: "17:00", employeeId: anya.id, category: "shift" });
    const sb = createShift(db, { date: daysFromNow(30), start: "09:00", end: "18:00", employeeId: igor.id, category: "shift" });
    const { bot, sent } = fakeBot();
    const app = createApp({ db, config, bot });
    const admin = await tokenFor(app, 111);
    const anyaToken = await tokenFor(app, 811);

    const created = await app.request("/api/swaps", authedJson(anyaToken, { fromShiftId: sa.id, toShiftId: sb.id }));
    const reqId = (await created.json()).request.id as number;
    sent.length = 0;

    // Диапазон — только день Игоря; форма поменяла вид и часы, как в правке
    // одной записи, только теперь через «Расставить с какого по какое».
    const res = await app.request("/api/admin/entries/range", authedJson(admin, {
      employeeId: igor.id, from: daysFromNow(30), to: daysFromNow(30), category: "duty",
      start: "10:00", end: "19:00", mode: "rewrite", includeWeekends: true,
    }));
    expect(res.status).toBe(201);
    expect(getShift(db, sb.id)).toMatchObject({ category: "duty", start: "10:00", end: "19:00" });

    const list = await app.request("/api/swaps", { headers: { Authorization: `Bearer ${anyaToken}` } });
    const rows = (await list.json()).swaps as { id: number; status: string }[];
    expect(rows.find((r) => r.id === reqId)?.status).toBe("expired");

    for (const chat of [811, 812]) {
      expect(sent.filter((m) => m.to === chat).map((m) => m.text).join("\n")).toContain("Обмен неактуален");
    }
    const expired = listRecentAudit(db, 20).find((e) => e.type === "swap_expired");
    expect(expired).toBeDefined();
    expect(expired!.payload).toMatchObject({ requestId: reqId });
  });

  it("перезапись диапазоном, не сменившая условия сделки, висящий обмен не трогает", async () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня", inviteToken: "inv-anya-r2" });
    const igor = createEmployee(db, { displayName: "Игорь", inviteToken: "inv-igor-r2" });
    linkTelegramAccount(db, "inv-anya-r2", 813);
    linkTelegramAccount(db, "inv-igor-r2", 814);
    const sa = createShift(db, { date: daysFromNow(30), start: "08:00", end: "17:00", employeeId: anya.id, category: "shift" });
    const sb = createShift(db, { date: daysFromNow(30), start: "09:00", end: "18:00", employeeId: igor.id, category: "shift" });
    const { bot, sent } = fakeBot();
    const app = createApp({ db, config, bot });
    const admin = await tokenFor(app, 111);
    const anyaToken = await tokenFor(app, 813);

    const created = await app.request("/api/swaps", authedJson(anyaToken, { fromShiftId: sa.id, toShiftId: sb.id }));
    const reqId = (await created.json()).request.id as number;
    sent.length = 0;

    // Те же день, часы и вид — только подпись назвали по-другому. Сделка,
    // о которой договаривались, не изменилась, гасить нечего.
    await app.request("/api/admin/entries/range", authedJson(admin, {
      employeeId: igor.id, from: daysFromNow(30), to: daysFromNow(30), category: "shift",
      start: "09:00", end: "18:00", title: "Вавилова", mode: "rewrite", includeWeekends: true,
    }));

    const list = await app.request("/api/swaps", { headers: { Authorization: `Bearer ${anyaToken}` } });
    const rows = (await list.json()).swaps as { id: number; status: string }[];
    expect(rows.find((r) => r.id === reqId)?.status).toBe("pending");
    expect(sent.filter((m) => m.text.includes("Обмен неактуален"))).toHaveLength(0);
  });
});

/**
 * Явная замена отсутствия (прод, 2026-10-16): админ открыл свой отпуск 12–17,
 * сохранил его сменой «День» — и перезапись пропустила все шесть дней, ничего
 * не поменяв. Флаг `replaceAbsences` режет отсутствие ровно по дням, где встаёт
 * рабочая запись; без флага — как было.
 */
describe("POST /api/admin/entries/range · replaceAbsences", () => {
  // 2026-10-12 — понедельник, 17-е — суббота.
  const vacationOf = (db: ReturnType<typeof makeTestDb>, employeeId: number) =>
    listShiftsInRange(db, "2026-10-01", "2026-10-31")
      .filter((r) => r.employeeId === employeeId && r.category === "vacation")
      .map((r) => ({ date: r.date, endDate: r.endDate }));

  it("один день посреди отпуска: смена встаёт, отпуск делится на до и после", async () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня" });
    const otpusk = createShift(db, { date: "2026-10-12", endDate: "2026-10-17", employeeId: anya.id, category: "vacation", note: "море" });
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);

    const res = await app.request("/api/admin/entries/range", authedJson(admin, {
      employeeId: anya.id, from: "2026-10-16", to: "2026-10-16", category: "shift", start: "09:00", end: "18:00",
      title: "День", mode: "rewrite", replaceAbsences: true,
    }));

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.created).toHaveLength(1);
    expect(body.created[0]).toMatchObject({ date: "2026-10-16", category: "shift", start: "09:00", end: "18:00" });
    expect(body.skipped).toEqual([]);
    expect(body.replacedAbsence).toEqual(["2026-10-16"]);
    // Первый кусок — та же строка (её id держат журнал и передачи), второй — новая.
    expect(getShift(db, otpusk.id)).toMatchObject({ date: "2026-10-12", endDate: "2026-10-15", category: "vacation" });
    expect(vacationOf(db, anya.id)).toEqual([
      { date: "2026-10-12", endDate: "2026-10-15" },
      { date: "2026-10-17", endDate: null },
    ]);
    // Кусок — тот же отпуск, а не голая строка: заметка уезжает с ним.
    const tail = listShiftsInRange(db, "2026-10-17", "2026-10-17").find((r) => r.category === "vacation")!;
    expect(tail.note).toBe("море");
  });

  it("без флага отпуск остаётся, а день пропущен — как раньше", async () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня" });
    createShift(db, { date: "2026-10-12", endDate: "2026-10-17", employeeId: anya.id, category: "vacation" });
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);

    const body = await (await app.request("/api/admin/entries/range", authedJson(admin, {
      employeeId: anya.id, from: "2026-10-16", to: "2026-10-16", category: "shift", start: "09:00", end: "18:00", mode: "rewrite",
    }))).json();

    expect(body.created).toEqual([]);
    expect(body.skipped).toEqual([{ date: "2026-10-16", reason: "absence" }]);
    expect(vacationOf(db, anya.id)).toEqual([{ date: "2026-10-12", endDate: "2026-10-17" }]);
  });

  it("весь отпуск на неделе: будни заменены, суббота без галочки осталась отпуском", async () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня" });
    const otpusk = createShift(db, { date: "2026-10-12", endDate: "2026-10-17", employeeId: anya.id, category: "vacation" });
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);

    const body = await (await app.request("/api/admin/entries/range", authedJson(admin, {
      employeeId: anya.id, from: "2026-10-12", to: "2026-10-17", category: "shift", start: "09:00", end: "18:00",
      mode: "rewrite", replaceAbsences: true,
    }))).json();

    expect(body.created).toHaveLength(5);
    expect(body.skipped).toEqual([{ date: "2026-10-17", reason: "weekend" }]);
    expect(getShift(db, otpusk.id)).toMatchObject({ date: "2026-10-17", endDate: null });
  });

  it("отпуск целиком внутри диапазона удаляется", async () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня" });
    const otpusk = createShift(db, { date: "2026-10-13", endDate: "2026-10-14", employeeId: anya.id, category: "vacation" });
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);

    const body = await (await app.request("/api/admin/entries/range", authedJson(admin, {
      employeeId: anya.id, from: "2026-10-12", to: "2026-10-16", category: "shift", start: "09:00", end: "18:00",
      mode: "fill", replaceAbsences: true,
    }))).json();

    expect(body.created).toHaveLength(5);
    expect(getShift(db, otpusk.id)).toBeUndefined();
    expect(vacationOf(db, anya.id)).toEqual([]);
  });

  it("журнал: строка диапазона с числом заменённых дней и правка самого отпуска", async () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня" });
    createShift(db, { date: "2026-10-12", endDate: "2026-10-17", employeeId: anya.id, category: "vacation" });
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);

    await app.request("/api/admin/entries/range", authedJson(admin, {
      employeeId: anya.id, from: "2026-10-16", to: "2026-10-16", category: "shift", start: "09:00", end: "18:00",
      mode: "rewrite", replaceAbsences: true,
    }));

    const events = listRecentAudit(db, 20);
    const range = events.find((e) => e.type === "entries_range_rewritten")!;
    expect(range.payload).toMatchObject({ created: 1, updated: 0, skipped: 0, absenceDaysReplaced: 1 });
    const updated = events.find((e) => e.type === "entry_updated")!;
    expect(updated.payload).toMatchObject({
      before: { date: "2026-10-12", endDate: "2026-10-17", category: "vacation" },
      after: { date: "2026-10-12", endDate: "2026-10-15", category: "vacation" },
    });
    expect(events.find((e) => e.type === "entry_created")?.payload).toMatchObject({ date: "2026-10-17", category: "vacation" });
  });

  it("журнал: удалённый целиком отпуск записан удалением", async () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня" });
    createShift(db, { date: "2026-10-13", endDate: null, employeeId: anya.id, category: "business_trip" });
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);

    await app.request("/api/admin/entries/range", authedJson(admin, {
      employeeId: anya.id, from: "2026-10-13", to: "2026-10-13", category: "shift", start: "09:00", end: "18:00",
      mode: "rewrite", replaceAbsences: true,
    }));

    expect(listRecentAudit(db, 20).find((e) => e.type === "entry_deleted")?.payload).toMatchObject({ category: "business_trip" });
  });

  it("работнику пишет письмо и про смену, и про отпуск — одно на всё", async () => {
    vi.useFakeTimers();
    try {
      const db = makeTestDb();
      const anya = createEmployee(db, { displayName: "Аня", inviteToken: "inv-anya-v" });
      linkTelegramAccount(db, "inv-anya-v", 556);
      createShift(db, { date: "2099-01-05", endDate: "2099-01-09", employeeId: anya.id, category: "vacation" });
      const { bot, sent } = fakeBot();
      const app = createApp({ db, config, bot });
      const admin = await tokenFor(app, 111);

      const res = await app.request("/api/admin/entries/range", authedJson(admin, {
        employeeId: anya.id, from: "2099-01-07", to: "2099-01-07", category: "shift", start: "09:00", end: "18:00",
        mode: "rewrite", replaceAbsences: true,
      }));
      expect((await res.json()).notified).toEqual({ delivered: 1, intended: 1 });

      await vi.advanceTimersByTimeAsync(NOTICE_WINDOW_MS + 100);
      const letters = sent.filter((m) => m.to === 556);
      expect(letters).toHaveLength(1);
      // Письмо называет и новую смену, и что стало с отпуском, — иначе человек
      // не узнал бы, что отпуска в среду больше нет.
      expect(letters[0]!.text).toContain("Ср 7 янв · 09:00–18:00 · Смена");
      expect(letters[0]!.text).toContain("Пн 5 янв – Вт 6 янв · весь день · Отпуск");
      expect(letters[0]!.text).toContain("Чт 8 янв – Пт 9 янв · весь день · Отпуск");
    } finally {
      vi.useRealTimers();
    }
  });

  it("отпуск, ушедший целиком, тоже назван в письме работнику", async () => {
    vi.useFakeTimers();
    try {
      const db = makeTestDb();
      const anya = createEmployee(db, { displayName: "Аня", inviteToken: "inv-anya-w" });
      linkTelegramAccount(db, "inv-anya-w", 557);
      createShift(db, { date: "2099-01-07", employeeId: anya.id, category: "vacation" });
      const { bot, sent } = fakeBot();
      const app = createApp({ db, config, bot });
      const admin = await tokenFor(app, 111);

      await app.request("/api/admin/entries/range", authedJson(admin, {
        employeeId: anya.id, from: "2099-01-07", to: "2099-01-07", category: "shift", start: "09:00", end: "18:00",
        mode: "rewrite", replaceAbsences: true,
      }));

      await vi.advanceTimersByTimeAsync(NOTICE_WINDOW_MS + 100);
      const letters = sent.filter((m) => m.to === 557);
      expect(letters).toHaveLength(1);
      expect(letters[0]!.text).toContain("Отпуск");
    } finally {
      vi.useRealTimers();
    }
  });

  it("работнику ручка недоступна и с флагом", async () => {
    const db = makeTestDb();
    const igor = createEmployee(db, { displayName: "Игорь", inviteToken: "inv-334" });
    linkTelegramAccount(db, "inv-334", 334);
    const otpusk = createShift(db, { date: "2026-10-12", endDate: "2026-10-17", employeeId: igor.id, category: "vacation" });
    const app = createApp({ db, config });
    const worker = await tokenFor(app, 334);

    const res = await app.request("/api/admin/entries/range", authedJson(worker, {
      employeeId: igor.id, from: "2026-10-16", to: "2026-10-16", category: "shift", start: "09:00", end: "18:00",
      mode: "rewrite", replaceAbsences: true,
    }));
    expect(res.status).toBe(403);
    expect(getShift(db, otpusk.id)).toMatchObject({ date: "2026-10-12", endDate: "2026-10-17" });
  });

  it("чужой отпуск в тех же днях не трогает", async () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня" });
    const mark = createEmployee(db, { displayName: "Марк" });
    createShift(db, { date: "2026-10-12", endDate: "2026-10-17", employeeId: mark.id, category: "vacation" });
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);

    await app.request("/api/admin/entries/range", authedJson(admin, {
      employeeId: anya.id, from: "2026-10-16", to: "2026-10-16", category: "shift", start: "09:00", end: "18:00",
      mode: "rewrite", replaceAbsences: true,
    }));
    expect(vacationOf(db, mark.id)).toEqual([{ date: "2026-10-12", endDate: "2026-10-17" }]);
  });
});

/**
 * Замена ОДНОГО отсутствия — путь правки (проверка ветки, 2026-10-16). Админ
 * правит отпуск 12–17 в «День» и тянет «По» до 24-го: общий `replaceAbsences`
 * срезал бы и отпуск 20–25, о котором форма молчит. Решение владельца: из
 * правки заменяется только правимая запись — `replaceAbsenceEntryId`.
 */
describe("POST /api/admin/entries/range · replaceAbsenceEntryId", () => {
  const setup = async () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня" });
    const igor = createEmployee(db, { displayName: "Игорь" });
    const first = createShift(db, { date: "2026-10-12", endDate: "2026-10-17", employeeId: anya.id, category: "vacation" });
    const second = createShift(db, { date: "2026-10-20", endDate: "2026-10-25", employeeId: anya.id, category: "vacation" });
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);
    const post = (body: Record<string, unknown>) =>
      app.request("/api/admin/entries/range", authedJson(admin, {
        employeeId: anya.id, from: "2026-10-12", to: "2026-10-24", category: "shift", start: "09:00", end: "18:00",
        mode: "rewrite", ...body,
      }));
    return { db, anya, igor, first, second, post };
  };

  it("режет только названный отпуск, второй в диапазоне не тронут и пропущен по отсутствию", async () => {
    const { db, first, second, post } = await setup();

    const res = await post({ replaceAbsenceEntryId: first.id });

    expect(res.status).toBe(201);
    const body = await res.json();
    // 12–16 — будни первого отпуска, 19-е — свободный понедельник.
    expect(body.created.map((s: { date: string }) => s.date)).toEqual([
      "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-19",
    ]);
    expect(body.replacedAbsence).toEqual(["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"]);
    expect(body.skipped.filter((s: { reason: string }) => s.reason === "absence").map((s: { date: string }) => s.date))
      .toEqual(["2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23"]);
    expect(getShift(db, first.id)).toMatchObject({ date: "2026-10-17", endDate: null });
    expect(getShift(db, second.id)).toMatchObject({ date: "2026-10-20", endDate: "2026-10-25", category: "vacation" });
    const audit = listRecentAudit(db, 10).find((a) => a.type === "entries_range_rewritten")!;
    expect(audit.payload).toMatchObject({ absenceDaysReplaced: 5 });
  });

  it("чужое отсутствие — 400 по-русски, ничего не тронуто", async () => {
    const { db, igor, first, post } = await setup();
    const foreign = createShift(db, { date: "2026-10-12", endDate: "2026-10-13", employeeId: igor.id, category: "sick_leave" });

    const res = await post({ replaceAbsenceEntryId: foreign.id });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Заменяемое отсутствие принадлежит другому человеку");
    expect(getShift(db, first.id)).toMatchObject({ date: "2026-10-12", endDate: "2026-10-17" });
    expect(getShift(db, foreign.id)).toMatchObject({ date: "2026-10-12", endDate: "2026-10-13" });
  });

  it("не отсутствие — 400 по-русски", async () => {
    const { db, anya, post } = await setup();
    const work = createShift(db, { date: "2026-10-19", employeeId: anya.id, category: "shift", start: "09:00", end: "18:00" });

    const res = await post({ replaceAbsenceEntryId: work.id });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Заменить можно только отпуск, больничный или командировку");
  });

  it("не найдено — 400 по-русски", async () => {
    const { post } = await setup();

    const res = await post({ replaceAbsenceEntryId: 99_999 });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Заменяемое отсутствие не найдено — обновите график");
  });

  it("вместе с общим replaceAbsences — 400: какое из двух правил, не угадать", async () => {
    const { first, post } = await setup();

    const res = await post({ replaceAbsenceEntryId: first.id, replaceAbsences: true });

    expect(res.status).toBe(400);
  });
});
