import { parseISODate, toISODate } from "@planer/shared";

/**
 * Разделы админской вкладки и разбор ссылки на них.
 *
 * Отдельным модулем, а не внутри `AdminScreen.tsx`, ровно по одной причине: сама
 * вкладка админа грузится отдельным куском (`lazy` в `App.tsx`), а этот разбор
 * нужен ПРИ СТАРТЕ — им решается, какую вкладку открыть. Статический импорт из
 * `AdminScreen.tsx` затянул бы в основной бандл все восемь админских экранов
 * вместе с ним, то есть отменил бы разделение.
 */
export type AdminSection =
  | "schedule"
  | "weekend"
  | "employees"
  | "checklists"
  | "announce"
  | "groups"
  | "bugs"
  | "journal"
  | "settings";

/** Что показывает вкладка «Админ»: раздел или меню разделов. */
export type AdminView = AdminSection | "menu";

/** Меню разделов: порядок и группы — решение заказчика, а не алфавит. Здесь, а не
 *  в `AdminMenu.tsx`, потому что название раздела нужно и заголовку экрана
 *  (`adminSectionTitle`), и тестам — один источник, без расхождения подписей. */
export const ADMIN_MENU: readonly { header: string; items: readonly { key: AdminSection; icon: string; title: string; hint: string }[] }[] = [
  { header: "График", items: [
    { key: "schedule", icon: "📅", title: "Расписание", hint: "Кто когда работает, правка смен" },
    { key: "weekend", icon: "🙋", title: "Выходные", hint: "Открыть смену на выходной и назначить" },
  ] },
  { header: "Люди", items: [
    { key: "employees", icon: "👥", title: "Работники", hint: "Состав, роли, дни рождения" },
    { key: "groups", icon: "🏷", title: "Группы", hint: "Списки людей для рассылок" },
  ] },
  { header: "Рассылки", items: [
    { key: "announce", icon: "📣", title: "Анонсы", hint: "Написать всей команде или части" },
    { key: "checklists", icon: "✅", title: "Чек-листы", hint: "Проверки дежурного и кому они уходят" },
  ] },
  { header: "Служебное", items: [
    { key: "journal", icon: "📊", title: "Журнал", hint: "Кто сколько отдежурил и кто что менял" },
    { key: "bugs", icon: "🐞", title: "Баги", hint: "Жалобы из бота" },
    { key: "settings", icon: "⚙️", title: "Настройки", hint: "Обмены, напоминания, праздники" },
  ] },
];

/** Название раздела — заголовок его экрана. */
export function adminSectionTitle(key: AdminSection): string {
  for (const group of ADMIN_MENU) {
    const item = group.items.find((i) => i.key === key);
    if (item) return item.title;
  }
  return key;
}

/** Раздел, на котором открыться, если мини-апп запущен ссылкой из бота.
 *  Своя функция, а не `screenFromSearch`: та отвечает за формы-оверлеи
 *  (больничный, мероприятие), а это — про вкладку админа. Один параметр,
 *  но два разных вопроса к нему. */
export function adminSectionFromSearch(search: string): AdminSection | null {
  const value = new URLSearchParams(search).get("screen");
  return value === "announce" || value === "schedule" ? value : null;
}

/**
 * Дата из ссылки на график («📅 Открыть график» у админских тревог) — только
 * настоящая календарная дата. Неверная строка не бросает и не роняет прыжок на
 * дату — экран открывается как обычно, просто без него (её решение из
 * `admin-deeplink.test.ts`).
 *
 * `Date` у невозможной даты не бросает, а перекатывает («2026-13-40» → какой-то
 * день следующего года) — поэтому проверка через обратное преобразование, а не
 * через ручные границы месяца/дня.
 */
export function scheduleDateFromSearch(search: string): string | null {
  const value = new URLSearchParams(search).get("date");
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return toISODate(parseISODate(value)) === value ? value : null;
}
