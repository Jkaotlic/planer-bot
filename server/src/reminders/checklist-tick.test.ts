import { describe, it, expect, vi } from "vitest";
import { GrammyError, type Bot } from "grammy";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount } from "../repo/employees";
import { createShift } from "../repo/shifts";
import { listActiveTemplates } from "../repo/templates";
import { createChecklistItem, setMark, updateChecklistItem } from "../repo/checklist";
import { createChecklist, setChecklistTemplates, updateChecklist } from "../repo/checklists";
import { testConfig } from "../test-config";
import { runChecklistTick } from "./checklist-tick";
import type { Db } from "../db/client";
import { reminderLog } from "../db/schema";

const config = testConfig();

function fakeBot() {
  const sent: { to: number; text: string }[] = [];
  const docs: { to: number; fileId: string; caption?: string }[] = [];
  const bot = {
    api: {
      sendMessage: vi.fn(async (to: number, text: string) => { sent.push({ to, text }); }),
      sendDocument: vi.fn(async (to: number, fileId: string, extra?: { caption?: string }) => {
        docs.push({ to, fileId, caption: extra?.caption });
      }),
    },
  };
  return { bot: bot as unknown as Bot, sent, docs };
}

const TODAY = "2026-08-24";

/** Дежурный с чек-листом: пресет отмечен галочкой, смена с 07:00 стоит на сегодня. */
function stage(opts: { items?: string[]; remindersEnabled?: boolean; linked?: boolean; linkedList?: boolean } = {}) {
  const db: Db = makeTestDb();
  const igor = createEmployee(db, { displayName: "Игорь", inviteToken: "inv-1" });
  if (opts.linked !== false) linkTelegramAccount(db, "inv-1", 333);
  if (opts.remindersEnabled === false) {
    db.run(`update employees set reminders_enabled = 0 where id = ${igor.id}` as never);
  }
  const duty = listActiveTemplates(db).find((t) => t.category === "duty")!;
  const list = createChecklist(db, "Обход 47-го");
  if (opts.linkedList !== false) setChecklistTemplates(db, list.id, [duty.id]);
  createShift(db, { date: TODAY, start: "07:00", end: "16:00", employeeId: igor.id, category: "duty", templateId: duty.id });
  for (const title of opts.items ?? ["Свет", "Окна"]) createChecklistItem(db, list.id, title);
  return { db, igor, duty, list };
}

describe("runChecklistTick", () => {
  /**
   * Ровно то, ради чего правка 2026-09-01: дежурному с 07:00 положены и общая
   * инструкция этажа, и отдельная задача на ту же смену. Пока связь была
   * колонкой, второй список отнимал вид смены у первого и уходил один.
   */
  it("шлёт по сообщению на каждый список смены", async () => {
    const { db, duty } = stage();
    const second = createChecklist(db, "Рисовалка");
    createChecklistItem(db, second.id, "Проверить рисовалку");
    setChecklistTemplates(db, second.id, [duty.id]);

    const { bot, sent } = fakeBot();
    expect(await runChecklistTick(db, bot, config, { date: TODAY, time: "07:05" })).toBe(2);
    expect(sent).toHaveLength(2);
    expect(sent[0]!.text).toContain("Свет");
    expect(sent[1]!.text).toContain("Проверить рисовалку");
  });

  // Дедупликация пер-списочная: общая пометка означала бы «что-то одно уже
  // уходило», и второй список молчал бы всегда.
  it("повторный тик не шлёт ни один из списков второй раз", async () => {
    const { db, duty } = stage();
    const second = createChecklist(db, "Рисовалка");
    createChecklistItem(db, second.id, "Проверить рисовалку");
    setChecklistTemplates(db, second.id, [duty.id]);

    const { bot, sent } = fakeBot();
    await runChecklistTick(db, bot, config, { date: TODAY, time: "07:05" });
    expect(await runChecklistTick(db, bot, config, { date: TODAY, time: "07:10" })).toBe(0);
    expect(sent).toHaveLength(2);
  });

  /**
   * Упавшая отправка не должна стоить дежурному второго списка — и не должна
   * пометить себя отправленной: чек-лист нужен в начале смены, и следующий тик
   * обязан попробовать снова.
   */
  it("падение одной отправки не мешает второй и не помечает упавшую", async () => {
    const { db, duty } = stage();
    const second = createChecklist(db, "Рисовалка");
    createChecklistItem(db, second.id, "Проверить рисовалку");
    setChecklistTemplates(db, second.id, [duty.id]);

    const { bot, sent } = fakeBot();
    vi.mocked(bot.api.sendMessage).mockRejectedValueOnce(new Error("Telegram молчит"));
    const failing = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await runChecklistTick(db, bot, config, { date: TODAY, time: "07:05" })).toBe(1);
    expect(sent.map((m) => m.text.includes("Проверить рисовалку"))).toEqual([true]);

    // Следующий тик досылает ровно упавший список.
    expect(await runChecklistTick(db, bot, config, { date: TODAY, time: "07:10" })).toBe(1);
    expect(sent).toHaveLength(2);
    expect(sent[1]!.text).toContain("Свет");
    failing.mockRestore();
  });

  it("присылает дежурному список пунктов после начала смены", async () => {
    const { db } = stage();
    const { bot, sent } = fakeBot();
    const count = await runChecklistTick(db, bot, config, { date: TODAY, time: "07:05" });
    expect(count).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe(333);
    expect(sent[0]!.text).toContain("Свет");
    expect(sent[0]!.text).toContain("Окна");
  });

  // Смена начинается в 07:00; в 06:30 человек ещё не на этаже, и проверять нечего.
  it("не пишет до начала смены", async () => {
    const { db } = stage();
    const { bot, sent } = fakeBot();
    expect(await runChecklistTick(db, bot, config, { date: TODAY, time: "06:30" })).toBe(0);
    expect(sent).toEqual([]);
  });

  // Тик крутится каждые пять минут: без дедупликации это два десятка сообщений за смену.
  it("шлёт одно сообщение на человека в день, сколько бы раз ни крутился", async () => {
    const { db } = stage();
    const { bot, sent } = fakeBot();
    await runChecklistTick(db, bot, config, { date: TODAY, time: "07:05" });
    await runChecklistTick(db, bot, config, { date: TODAY, time: "07:10" });
    await runChecklistTick(db, bot, config, { date: TODAY, time: "09:00" });
    expect(sent).toHaveLength(1);
  });

  it("молчит, когда в чек-листе нет ни пунктов, ни пояснения, ни файла", async () => {
    const { db } = stage({ items: [] });
    const { bot, sent } = fakeBot();
    expect(await runChecklistTick(db, bot, config, { date: TODAY, time: "07:05" })).toBe(0);
    expect(sent).toEqual([]);
  });

  /**
   * Чек-лист — рабочая инструкция, а не напоминание об удобстве, и личная
   * галочка «не пиши мне про смены» его не глушит.
   *
   * До 2026-08-28 глушила, и это стоило троим людям месяца без инструкций:
   * человек выключал 🔕 под вечерним напоминанием, бот отвечал «Напоминания о
   * сменах выключены», а вместе с ними тихо пропадали и чек-листы дежурного.
   */
  it("пишет и тому, кто выключил себе напоминания о сменах", async () => {
    const { db } = stage({ remindersEnabled: false });
    const { bot, sent } = fakeBot();
    expect(await runChecklistTick(db, bot, config, { date: TODAY, time: "07:05" })).toBe(1);
    expect(sent).toHaveLength(1);
  });

  it("молчит тому, кто не привязал телеграм", async () => {
    const { db } = stage({ linked: false });
    const { bot, sent } = fakeBot();
    expect(await runChecklistTick(db, bot, config, { date: TODAY, time: "07:05" })).toBe(0);
    expect(sent).toEqual([]);
  });

  it("не пишет тому, чей вид смены к чек-листу не привязан", async () => {
    const { db, igor, list } = stage();
    setChecklistTemplates(db, list.id, []);
    expect(igor.id).toBeGreaterThan(0);
    const { bot, sent } = fakeBot();
    expect(await runChecklistTick(db, bot, config, { date: TODAY, time: "07:05" })).toBe(0);
    expect(sent).toEqual([]);
  });

  // Человек мог начать в мини-аппе и открыть чат: сообщение обязано показывать
  // уже сделанное сделанным, иначе оно спорит с экраном.
  it("показывает уже отмеченные пункты отмеченными", async () => {
    const { db, igor, list: stageList } = stage();
    const item = createChecklistItem(db, stageList.id, "Двери");
    setMark(db, { date: TODAY, employeeId: igor.id, itemId: item.id, done: true });
    const { bot, sent } = fakeBot();
    await runChecklistTick(db, bot, config, { date: TODAY, time: "07:05" });
    expect(sent[0]!.text).toContain("✅ Двери");
    expect(sent[0]!.text).toContain("◻️ Свет");
    expect(sent[0]!.text).toContain("1 из 3");
  });

  it("кладёт в сообщение общее пояснение и пояснения пунктов", async () => {
    const { db, list } = stage({ items: [] });
    const item = createChecklistItem(db, list.id, "Обойти этаж");
    updateChecklistItem(db, item.id, { note: "По часовой, от лифтов" });
    updateChecklist(db, list.id, { note: "Начинаем с 47-го" });

    const { bot, sent } = fakeBot();
    await runChecklistTick(db, bot, config, { date: TODAY, time: "07:05" });
    expect(sent[0]!.text).toContain("Начинаем с 47-го");
    expect(sent[0]!.text).toContain("По часовой, от лифтов");
  });

  // Файл живёт в Telegram и пересылается по `file_id`: своё хранилище ради
  // одного PDF означало бы бэкапы, права и чистку — всё то, что Telegram делает сам.
  it("присылает приложенный файл вместе с чек-листом", async () => {
    const { db, list } = stage();
    updateChecklist(db, list.id, { docFileId: "BQACAgIAAx", docName: "Проверка 47.pdf" });
    const { bot, sent, docs } = fakeBot();

    await runChecklistTick(db, bot, config, { date: TODAY, time: "07:05" });
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ to: 333, fileId: "BQACAgIAAx" });
    expect(sent).toHaveLength(1);
  });

  it("файла нет — документ не шлётся вовсе", async () => {
    const { db } = stage();
    const { bot, docs } = fakeBot();
    await runChecklistTick(db, bot, config, { date: TODAY, time: "07:05" });
    expect(docs).toEqual([]);
  });

  // Один файл в день, ровно как одно сообщение: тик крутится каждые пять минут.
  it("не шлёт файл повторно на следующем тике", async () => {
    const { db, list } = stage();
    updateChecklist(db, list.id, { docFileId: "BQACAgIAAx", docName: "Проверка 47.pdf" });
    const { bot, docs } = fakeBot();
    await runChecklistTick(db, bot, config, { date: TODAY, time: "07:05" });
    await runChecklistTick(db, bot, config, { date: TODAY, time: "07:10" });
    expect(docs).toHaveLength(1);
  });

  it("ссылка на инструкцию едет кнопкой, а не текстом в теле", async () => {
    const { db, list } = stage();
    updateChecklist(db, list.id, { docUrl: "https://disk.example/47.pdf" });
    const bot = fakeBot();
    const calls: unknown[] = [];
    (bot.bot as unknown as { api: { sendMessage: (...a: unknown[]) => Promise<void> } }).api.sendMessage =
      async (...args: unknown[]) => { calls.push(args); };

    await runChecklistTick(db, bot.bot, config, { date: TODAY, time: "07:05" });
    const [, text, extra] = calls[0] as [number, string, { reply_markup?: { inline_keyboard: { text: string; url?: string }[][] } }];
    expect(text).not.toContain("https://disk.example/47.pdf");
    const urls = extra.reply_markup!.inline_keyboard.flat().filter((b) => b.url);
    expect(urls.map((b) => b.url)).toContain("https://disk.example/47.pdf");
  });

  // Пояснение и приложенная инструкция — уже полноценное сообщение. Список
  // пунктов админ может не завести вовсе: 2026-08-26 у «Дежурств 47» были и
  // пояснение, и docx, и ни одного пункта, — и молчание «пока не появится
  // первый пункт» означало, что не ушло вообще ничего и никогда.
  it("шлёт пояснение и инструкцию, когда пунктов в списке нет", async () => {
    const { db, list } = stage({ items: [] });
    updateChecklist(db, list.id, { note: "Обход по инструкции", docFileId: "BQACAgIAAx", docName: "Инструкция.docx" });
    const { bot, sent, docs } = fakeBot();

    expect(await runChecklistTick(db, bot, config, { date: TODAY, time: "07:05" })).toBe(1);
    expect(sent[0]!.text).toContain("Обход по инструкции");
    expect(docs).toHaveLength(1);
  });

  it("шлёт одно пояснение, когда нет ни пунктов, ни файла", async () => {
    const { db, list } = stage({ items: [] });
    updateChecklist(db, list.id, { note: "Обход по инструкции" });
    const { bot, sent } = fakeBot();

    expect(await runChecklistTick(db, bot, config, { date: TODAY, time: "07:05" })).toBe(1);
    expect(sent[0]!.text).toContain("Обход по инструкции");
  });

  // «Сделано 0 из 0» и заголовок «— на сегодня:» обещают список, которого в
  // сообщении нет: на экране это читается как поломка, а не как инструкция.
  it("без пунктов не пишет ни счётчика, ни обещания списка", async () => {
    const { db, list } = stage({ items: [] });
    updateChecklist(db, list.id, { note: "Обход по инструкции" });
    const { bot, sent } = fakeBot();

    await runChecklistTick(db, bot, config, { date: TODAY, time: "07:05" });
    expect(sent[0]!.text).not.toContain("Сделано");
    expect(sent[0]!.text).not.toContain("на сегодня");
  });

  // Кнопка ведёт на карточку, в которой нечего отмечать, — то же обещание
  // маршрута, которого нет, что и у `?screen=…`.
  it("без пунктов не предлагает «Отметить»", async () => {
    const { db, list } = stage({ items: [] });
    updateChecklist(db, list.id, { note: "Обход по инструкции" });
    const bot = fakeBot();
    const calls: unknown[] = [];
    (bot.bot as unknown as { api: { sendMessage: (...a: unknown[]) => Promise<void> } }).api.sendMessage =
      async (...args: unknown[]) => { calls.push(args); };

    await runChecklistTick(db, bot.bot, config, { date: TODAY, time: "07:05" });
    const [, , extra] = calls[0] as [number, string, { reply_markup?: { inline_keyboard: { text: string }[][] } }];
    const buttons = (extra?.reply_markup?.inline_keyboard ?? []).flat();
    expect(buttons.map((b) => b.text)).not.toContain("☑️ Отметить");
  });

  // Задача 7: у многодневной записи (дежурство на неделю) один ряд `shifts` на
  // весь диапазон — без дня в ключе пометки чек-лист уходил один раз в
  // понедельник и молчал до воскресенья.
  describe("многодневная запись получает чек-лист каждый день", () => {
    function multiDayStage() {
      const db: Db = makeTestDb();
      const igor = createEmployee(db, { displayName: "Игорь", inviteToken: "inv-1" });
      linkTelegramAccount(db, "inv-1", 333);
      const duty = listActiveTemplates(db).find((t) => t.category === "duty")!;
      const list = createChecklist(db, "Обход 47-го");
      setChecklistTemplates(db, list.id, [duty.id]);
      createShift(db, {
        date: "2026-07-13", endDate: "2026-07-19", start: "07:00", end: "16:00",
        employeeId: igor.id, category: "duty", templateId: duty.id,
      });
      createChecklistItem(db, list.id, "Свет");
      return { db, igor, duty, list };
    }

    it("уходит на 13-е и снова на 14-е; повторный тик 14-го не дублирует", async () => {
      const { db } = multiDayStage();
      const { bot, sent } = fakeBot();

      expect(await runChecklistTick(db, bot, config, { date: "2026-07-13", time: "07:05" })).toBe(1);
      expect(await runChecklistTick(db, bot, config, { date: "2026-07-14", time: "07:05" })).toBe(1);
      expect(await runChecklistTick(db, bot, config, { date: "2026-07-14", time: "07:10" })).toBe(0);
      expect(sent).toHaveLength(2);
    });

    // Однодневная запись держит прежний вид пометки — без `@дня` — иначе в день
    // выкатки сегодняшние чек-листы ушли бы второй раз.
    it("однодневная запись: одна отправка в день, вид пометки без «@»", async () => {
      const { db } = stage();

      const { bot, sent } = fakeBot();
      await runChecklistTick(db, bot, config, { date: TODAY, time: "07:05" });
      await runChecklistTick(db, bot, config, { date: TODAY, time: "07:10" });
      expect(sent).toHaveLength(1);

      const rows = db.select().from(reminderLog).all().filter((r) => r.kind.startsWith("duty_checklist:"));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.kind).toMatch(/^duty_checklist:\d+$/);
    });
  });

  describe("сбои отправки", () => {
    function refusal(code: number, description: string): GrammyError {
      return new GrammyError(`Call failed! (${code}: ${description})`, { ok: false, error_code: code, description }, "sendMessage", {});
    }

    it("файл ушёл, а текст нет — на следующем тике файл не повторяется", async () => {
      const { db, list } = stage();
      updateChecklist(db, list.id, { docFileId: "BQACAgIAAx", docName: "Проверка 47.pdf" });
      const { bot, sent, docs } = fakeBot();
      let textDown = true;
      (bot.api.sendMessage as ReturnType<typeof vi.fn>).mockImplementation(async (to: number, text: string) => {
        if (textDown) throw new Error("Network request for 'sendMessage' failed!");
        sent.push({ to, text });
      });

      await runChecklistTick(db, bot, config, { date: TODAY, time: "07:05" });
      textDown = false;
      await runChecklistTick(db, bot, config, { date: TODAY, time: "07:10" });

      expect(docs).toHaveLength(1);
      expect(sent).toHaveLength(1);
    });

    it("битый файл (Telegram отверг file_id) не оставляет дежурного без списка", async () => {
      const { db, list } = stage();
      updateChecklist(db, list.id, { docFileId: "stale-file-id" });
      const { bot, sent } = fakeBot();
      (bot.api.sendDocument as ReturnType<typeof vi.fn>).mockRejectedValue(refusal(400, "Bad Request: wrong file identifier"));

      await runChecklistTick(db, bot, config, { date: TODAY, time: "07:05" });

      expect(sent).toHaveLength(1);
    });

    it("заблокировавшему бота не долбит каждые пять минут до полуночи", async () => {
      const { db } = stage();
      const { bot } = fakeBot();
      const send = bot.api.sendMessage as ReturnType<typeof vi.fn>;
      send.mockRejectedValue(refusal(403, "Forbidden: bot was blocked by the user"));

      await runChecklistTick(db, bot, config, { date: TODAY, time: "07:05" });
      await runChecklistTick(db, bot, config, { date: TODAY, time: "07:10" });

      expect(send).toHaveBeenCalledTimes(1);
    });

    it("после конца смены не пишет — сеть вернулась, а дежурный уже ушёл", async () => {
      const { db } = stage();
      const { bot, sent } = fakeBot();

      await runChecklistTick(db, bot, config, { date: TODAY, time: "16:30" });

      expect(sent).toEqual([]);
    });

    it("ночную смену (конец раньше начала) до полуночи не считает закончившейся", async () => {
      const { db, igor, duty } = stage({ linkedList: true });
      // Дневную смену из stage убираем из уравнения: смотрим на ночную.
      db.run("delete from shifts" as never);
      createShift(db, { date: TODAY, start: "20:00", end: "08:00", employeeId: igor.id, category: "duty", templateId: duty.id });
      const { bot, sent } = fakeBot();

      await runChecklistTick(db, bot, config, { date: TODAY, time: "20:05" });

      expect(sent).toHaveLength(1);
    });
  });
});
