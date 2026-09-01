import { describe, expect, it } from "vitest";
import {
  CHECKLIST_RULE_TEXT,
  checklistDayTotals,
  checklistDelivery,
  checklistDeliveryLabel,
  checklistDispatchBadge,
  checklistDispatchReason,
  checklistDispatchState,
  checklistHasContent,
  checklistProgress,
  checklistText,
  checklistsDueToday,
  isChecklistComplete,
  type ChecklistDelivery,
} from "./checklist";

const item = (id: number, title: string) => ({ id, title });

describe("checklistsDueToday", () => {
  const entry = (over: Record<string, unknown> = {}) => ({
    date: "2026-08-24", employeeId: 3, endDate: null, templateId: 5, ...over,
  });
  // Пресет 5 («с 07:00») ведёт на чек-лист 1, пресет 6 («с 08:00») — на 2.
  const byTemplate = new Map([[5, [1]], [6, [2]]]);

  it("отдаёт чек-лист того вида смены, что стоит сегодня", () => {
    expect(checklistsDueToday([entry()], byTemplate, "2026-08-24", 3)).toEqual([1]);
  });

  /** Ровно то, ради чего правка: у «с семи» и «с восьми» проверки разные. */
  it("у разных видов смен — разные чек-листы", () => {
    expect(checklistsDueToday([entry({ templateId: 6 })], byTemplate, "2026-08-24", 3)).toEqual([2]);
  });

  it("две записи разных видов в один день приносят оба списка, по порядку", () => {
    const day = [entry({ templateId: 6 }), entry({ templateId: 5 })];
    expect(checklistsDueToday(day, byTemplate, "2026-08-24", 3)).toEqual([2, 1]);
  });

  // Один и тот же чек-лист у двух записей — один список, а не два: человек не
  // проходит одни и те же пункты дважды.
  it("один и тот же чек-лист не двоится", () => {
    const day = [entry(), entry({ templateId: 5 })];
    expect(checklistsDueToday(day, byTemplate, "2026-08-24", 3)).toEqual([1]);
  });

  /**
   * Ровно то, ради чего правка 2026-09-01: у вида смены списков может быть
   * несколько. Порядок — как в карте: он приходит из базы отсортированным, и
   * дежурный должен получать сообщения в одном и том же порядке изо дня в день.
   */
  it("вид смены приносит все назначенные ему списки", () => {
    const many = new Map([[5, [1, 2]]]);
    expect(checklistsDueToday([entry()], many, "2026-08-24", 3)).toEqual([1, 2]);
  });

  // Общий список у двух видов смен дня — один список: человек не проходит одни
  // и те же пункты дважды, с какой бы стороны они ни пришли.
  it("общий список двух видов смен не двоится", () => {
    const many = new Map([[5, [1]], [6, [1, 2]]]);
    const day = [entry(), entry({ templateId: 6 })];
    expect(checklistsDueToday(day, many, "2026-08-24", 3)).toEqual([1, 2]);
  });

  it("вид смены без привязки ничего не приносит", () => {
    expect(checklistsDueToday([entry({ templateId: 2 })], byTemplate, "2026-08-24", 3)).toEqual([]);
  });

  it("не путает дни и людей", () => {
    expect(checklistsDueToday([entry()], byTemplate, "2026-08-25", 3)).toEqual([]);
    expect(checklistsDueToday([entry()], byTemplate, "2026-08-24", 9)).toEqual([]);
  });

  // Запись без пресета взяться может: смену ставят и «своим временем».
  // Привязка живёт на пресете, и без него взять её неоткуда.
  it("запись без пресета чек-листа не приносит", () => {
    expect(checklistsDueToday([entry({ templateId: null })], byTemplate, "2026-08-24", 3)).toEqual([]);
  });

  it("многодневная запись накрывает каждый свой день", () => {
    const span = [entry({ date: "2026-08-24", endDate: "2026-08-26" })];
    expect(checklistsDueToday(span, byTemplate, "2026-08-25", 3)).toEqual([1]);
    expect(checklistsDueToday(span, byTemplate, "2026-08-27", 3)).toEqual([]);
  });
});

describe("checklistProgress", () => {
  const items = [item(1, "Свет"), item(2, "Окна"), item(3, "Двери")];

  it("считает отмеченные из всех", () => {
    expect(checklistProgress(items, [2])).toEqual({ done: 1, total: 3 });
  });

  // Отметка по пункту, который потом убрали, в счёт не идёт: иначе «3 из 2»
  // читается как ошибка системы, а не как история.
  it("отметку по погашенному пункту не считает", () => {
    expect(checklistProgress(items, [2, 99])).toEqual({ done: 1, total: 3 });
  });

  it("пустой список — ноль из нуля, и он не пройден", () => {
    expect(checklistProgress([], [])).toEqual({ done: 0, total: 0 });
    expect(isChecklistComplete([], [])).toBe(false);
  });

  it("пройден, когда отмечены все", () => {
    expect(isChecklistComplete(items, [1, 2, 3])).toBe(true);
    expect(isChecklistComplete(items, [1, 2])).toBe(false);
  });
});

describe("checklistText", () => {
  it("перечисляет пункты, а не пересказывает их числом", () => {
    const text = checklistText([item(1, "Свет"), item(2, "Окна")], [1]);
    expect(text).toContain("Свет");
    expect(text).toContain("Окна");
    // Отмеченное видно отмеченным — человек мог начать в мини-аппе и открыть чат.
    expect(text).toContain("✅");
    expect(text).toContain("◻️");
  });

  it("говорит, сколько уже сделано", () => {
    expect(checklistText([item(1, "Свет"), item(2, "Окна")], [1])).toContain("1 из 2");
  });
});

describe("checklistHasContent", () => {
  const items = [item(1, "Свет")];

  it("список с пунктами есть чем рассылать", () => {
    expect(checklistHasContent({ items, note: null, hasDoc: false })).toBe(true);
  });

  // Ровно случай «Дежурств 47» (2026-08-26): пунктов нет, а пояснение и файл
  // есть — и это полноценное сообщение дежурному.
  it("одного пояснения хватает, даже без пунктов", () => {
    expect(checklistHasContent({ items: [], note: "обход от лифтов", hasDoc: false })).toBe(true);
  });

  it("одного файла хватает, даже без пунктов и пояснения", () => {
    expect(checklistHasContent({ items: [], note: null, hasDoc: true })).toBe(true);
  });

  it("пустое пояснение содержимым не считается", () => {
    expect(checklistHasContent({ items: [], note: "   ", hasDoc: false })).toBe(false);
  });

  it("ни пунктов, ни пояснения, ни файла — рассылать нечего", () => {
    expect(checklistHasContent({ items: [], note: null, hasDoc: false })).toBe(false);
  });
});

describe("checklistDispatchState", () => {
  it("есть содержимое и хотя бы один вид смены — список уходит", () => {
    expect(checklistDispatchState({ hasContent: true, linkedTemplateCount: 1 })).toBe("sends");
  });

  // Самая частая непонятность админа: список заполнен, но не назначен никому, и
  // молчание бота выглядит поломкой.
  it("без видов смен список не уходит никому", () => {
    expect(checklistDispatchState({ hasContent: true, linkedTemplateCount: 0 })).toBe("no-templates");
  });

  it("назначенный, но пустой список не уходит", () => {
    expect(checklistDispatchState({ hasContent: false, linkedTemplateCount: 2 })).toBe("empty");
  });

  // Пустота называется первой: наполнить список придётся в любом случае, а
  // назначить его можно и потом.
  it("пустой и никому не назначенный — сначала про пустоту", () => {
    expect(checklistDispatchState({ hasContent: false, linkedTemplateCount: 0 })).toBe("empty");
  });
});

describe("checklistDelivery", () => {
  const person = (over: Record<string, unknown> = {}) => ({
    sends: true, alreadySent: false, hasTelegram: true, ...over,
  });

  it("ещё не ушло, но уйдёт", () => {
    expect(checklistDelivery(person())).toBe("scheduled");
  });

  it("уже ушло сегодня", () => {
    expect(checklistDelivery(person({ alreadySent: true }))).toBe("sent");
  });

  // Единственный молчаливый пропуск, который остался у тика: писать некуда.
  it("без Telegram не уйдёт", () => {
    expect(checklistDelivery(person({ hasTelegram: false }))).toBe("no-telegram");
  });

  it("пустой список не уйдёт никому, даже готовому его получить", () => {
    expect(checklistDelivery(person({ sends: false }))).toBe("nothing-to-send");
  });
});

describe("подписи для экрана", () => {
  it("бейдж отвечает одним словом, а причина — отдельной строкой", () => {
    expect(checklistDispatchBadge("sends")).toBe("Уходит");
    expect(checklistDispatchBadge("no-templates")).toBe("Не уходит");
    expect(checklistDispatchBadge("empty")).toBe("Не уходит");
  });

  it("уходящий список называет виды смен, которым он положен", () => {
    expect(checklistDispatchReason("sends", ["Дежурство 07:00", "Утро"])).toBe("Дежурство 07:00, Утро");
  });

  it("не уходящий называет причину, а не молчит", () => {
    expect(checklistDispatchReason("no-templates", [])).toBe("не выбран вид смены");
    expect(checklistDispatchReason("empty", [])).toBe("ни пунктов, ни пояснения, ни файла, и не выбран вид смены");
  });

  // «Кому положен» и «уйдёт ли» — разные вопросы: пустота списка не повод
  // забыть, каким видам смен он назначен.
  it("пустой список всё равно называет, кому он назначен", () => {
    expect(checklistDispatchReason("empty", ["Утро"])).toBe("ни пунктов, ни пояснения, ни файла. Назначен: Утро");
  });

  it("время отправки — это начало смены, и оно названо", () => {
    expect(checklistDeliveryLabel("scheduled", "07:00")).toBe("уйдёт в 07:00");
  });

  // Смена «своим временем» без начала: тик шлёт такому первым же проходом.
  it("без начала смены обещается не час, а событие", () => {
    expect(checklistDeliveryLabel("scheduled", null)).toBe("уйдёт с началом смены");
  });

  // «Ушло в 07:02» — единственный ответ на вопрос «уходило сегодня или нет»,
  // который не требует верить экрану на слово.
  it("отправленное называет час, когда это случилось", () => {
    expect(checklistDeliveryLabel("sent", "07:00", "07:02")).toBe("ушло в 07:02");
  });

  it("отправленное без часа не обещает будущего", () => {
    expect(checklistDeliveryLabel("sent", "07:00")).toBe("уже отправлено");
  });

  it("каждый молчаливый пропуск назван причиной", () => {
    expect(checklistDeliveryLabel("no-telegram", "07:00")).toBe("не уйдёт: нет Telegram");
    expect(checklistDeliveryLabel("nothing-to-send", "07:00")).toBe("не уйдёт: в списке пусто");
  });

  // Правило — то самое, чего на экране не было вовсе; проверяем, что оно
  // отвечает на оба вопроса админа: кому и когда.
  it("правило словами называет и адресата, и момент, и оба исключения", () => {
    expect(CHECKLIST_RULE_TEXT).toContain("вида");
    expect(CHECKLIST_RULE_TEXT).toContain("начал");
    expect(CHECKLIST_RULE_TEXT).toContain("один раз");
    expect(CHECKLIST_RULE_TEXT).toContain("напоминания");
    expect(CHECKLIST_RULE_TEXT).toContain("Telegram");
  });
});

describe("checklistDayTotals", () => {
  const row = (delivery: ChecklistDelivery) => ({ delivery });

  it("считает ушедшее, ожидаемое и застрявшее по отдельности", () => {
    const totals = checklistDayTotals([
      row("sent"), row("sent"), row("scheduled"), row("no-telegram"), row("nothing-to-send"),
    ]);
    expect(totals).toEqual({ sent: 2, waiting: 1, blocked: 2 });
  });

  // Пустой день — не «всё хорошо» и не «всё плохо»: сегодня чек-лист просто
  // никому не положен, и три нуля читаются именно так.
  it("пустой день — три нуля", () => {
    expect(checklistDayTotals([])).toEqual({ sent: 0, waiting: 0, blocked: 0 });
  });

  it("непривязанный Telegram и пустой список считаются вместе — оба не дойдут", () => {
    expect(checklistDayTotals([row("nothing-to-send"), row("no-telegram")]).blocked).toBe(2);
  });
});
