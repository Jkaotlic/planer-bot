import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Сторож паритета: что умеет одна морда, умеет и другая — или записано почему нет.
 *
 * Повод: к 2026-09-28 консоль отстала от админки мини-аппа на четыре функции
 * (праздники, «Что мне писать», обращение, «Заполнить неделю»), и ни один тест
 * этого не видел — метод появлялся в одном `apiClient`, и расхождение жило,
 * пока его не находил человек. Теперь новый метод в одной морде без записи
 * ниже роняет этот тест.
 *
 * Сравниваются имена методов интерфейса `ApiClient`, прочитанные из исходников
 * как текст. Не импортом: оба клиента тянут `import.meta.env` и браузерные
 * модули, а сравнивать нужно ровно объявленное, а не то, что соберётся.
 *
 * Лежит в `shared`, а не в `admin`: это сторож двух пакетов сразу, как и
 * `boundaries.test.ts` рядом, и `node:fs` здесь в типах есть, а у консоли нет.
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/** Только в мини-аппе — и почему консоли это не нужно. */
const MINIAPP_ONLY: Record<string, string> = {
  // Рабочие методы работника: консоль — инструмент админа, своего графика,
  // обменов и выходных у неё нет.
  getBootstrap: "стартовый пакет вкладок работника",
  getMyShifts: "свои смены работника",
  getSwaps: "обмены работника",
  proposeSwap: "обмены работника",
  acceptSwap: "обмены работника",
  declineSwap: "обмены работника",
  cancelSwap: "обмены работника",
  createSelfEntry: "самозапись работника (больничный, мероприятие)",
  updateSelfEntry: "самозапись работника",
  deleteSelfEntry: "самозапись работника",
  offerHandover: "передача смены с больничного — шаг работника",
  skipHandover: "передача смены с больничного — шаг работника",
  expressInterest: "«Хочу» на выходной — работник",
  withdrawInterest: "«Хочу» на выходной — работник",
  getWeekendOffers: "предложения выходных работнику",
  confirmOffer: "предложения выходных работнику",
  declineOffer: "предложения выходных работнику",
  getMyChecklists: "чек-лист дежурного на его смене",
  markChecklistItem: "галочка дежурного в чек-листе",
  getMyCollections: "вкладка «Команда»: сборы глазами скидывающегося",
  // Личные настройки того, кто открыл мини-апп. Консоль — не «моё», у неё
  // нет вкладок, напоминаний и календаря в телефон.
  setPreferredName: "«Как ко мне обращаться» — себе; админ правит чужое через setEmployeePreferredName",
  setRemindersEnabled: "свои напоминания о сменах",
  setStartTab: "стартовая вкладка мини-аппа",
  setSelfScheduleEnabled: "свой график наблюдателя",
  getCalendarLink: "подписка на свой календарь в телефоне",
  createCalendarLink: "подписка на свой календарь в телефоне",
  deleteCalendarLink: "подписка на свой календарь в телефоне",
  // Одна ручка — два имени. В мини-аппе `getEmployees`/`getWeekendSlots`
  // заняты работником, поэтому админские версии там с приставкой.
  getAdminEmployees: "то же, что getEmployees консоли",
  getAdminWeekendSlots: "то же, что getWeekendSlots консоли",
};

/** Только в консоли — и почему мини-аппу это не нужно. */
const CONSOLE_ONLY: Record<string, string> = {
  getEmployees: "то же, что getAdminEmployees мини-аппа",
  getEvents: "лента «События» в правой колонке консоли; у телефона её нет, журнал — getJournal у обеих",
  getShiftCountsCsv: "CSV-отчёт «сколько смен» — скачивание файла; в мини-аппе отчёт только таблицей",
  getDayCalendar:
    "календарь недели отдельным методом: консоль берёт из ответа getTeamSchedule только записи, мини-апп — ответ целиком с calendar",
};

function apiClientMethods(relPath: string): Set<string> {
  const text = readFileSync(resolve(repoRoot, relPath), "utf8");
  const start = text.indexOf("export interface ApiClient {");
  if (start < 0) throw new Error(`${relPath}: нет «export interface ApiClient {» — сторож не знает, что сравнивать`);
  // Интерфейс кончается первой закрывающей скобкой в начале строки: так он
  // оформлен в обоих файлах, вложенные типы стоят с отступом.
  const end = text.indexOf("\n}", start);
  const body = text.slice(start, end);
  const names = [...body.matchAll(/^ {2}([A-Za-z]\w*)\??\(/gm)].map((m) => m[1]!);
  if (names.length < 20) throw new Error(`${relPath}: нашёл ${names.length} методов — разбор сломался, а не клиенты сошлись`);
  return new Set(names);
}

const miniapp = apiClientMethods("miniapp/src/api/client.ts");
const consoleApi = apiClientMethods("admin/src/api/client.ts");

describe("паритет apiClient консоли и мини-аппа", () => {
  it("всё, что есть только в мини-аппе, записано с причиной", () => {
    const unexplained = [...miniapp].filter((name) => !consoleApi.has(name) && !(name in MINIAPP_ONLY));
    expect(
      unexplained,
      `Есть в мини-аппе, нет в консоли: ${unexplained.join(", ")}. Перенеси в admin/src/api/client.ts ` +
        "или запиши в MINIAPP_ONLY с причиной, почему консоли это не нужно.",
    ).toEqual([]);
  });

  it("всё, что есть только в консоли, записано с причиной", () => {
    const unexplained = [...consoleApi].filter((name) => !miniapp.has(name) && !(name in CONSOLE_ONLY));
    expect(
      unexplained,
      `Есть в консоли, нет в мини-аппе: ${unexplained.join(", ")}. Перенеси в miniapp/src/api/client.ts ` +
        "или запиши в CONSOLE_ONLY с причиной, почему мини-аппу это не нужно.",
    ).toEqual([]);
  });

  // Список, переживший расхождение, врёт следующему читателю: «это намеренно»
  // про метод, который давно есть у обеих, прикрыл бы новое расхождение с тем
  // же именем.
  it("в списках нет устаревших записей", () => {
    const stale = [
      ...Object.keys(MINIAPP_ONLY).filter((name) => !miniapp.has(name) || consoleApi.has(name)),
      ...Object.keys(CONSOLE_ONLY).filter((name) => !consoleApi.has(name) || miniapp.has(name)),
    ];
    expect(stale, `Уже не расхождение — убери из списка: ${stale.join(", ")}`).toEqual([]);
  });
});
