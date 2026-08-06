# `/week` — график команды на неделю картинкой: план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Команда `/week`, видимая всем, присылает в чат PNG с сеткой «команда × 7 дней» и легендой, листаемый кнопками «‹ Пред. / ⌂ Текущая / След. ›».

**Architecture:** Модель недели и палитры переезжают из мини-аппа в `@planer/shared`, чтобы картинка и экран рисовались из одного источника. Сервер строит модель, превращает её в SVG чистой функцией и растеризует в PNG через `@resvg/resvg-js` с приложенным шрифтом. Бот отдаёт PNG фотографией и перерисовывает его при листании через `editMessageMedia`.

**Tech Stack:** TypeScript (ESM, strict), vitest, grammy, hono, drizzle + better-sqlite3, `@resvg/resvg-js`.

Спека: [`docs/superpowers/specs/2026-08-06-week-image-command-design.md`](../specs/2026-08-06-week-image-command-design.md)

## Global Constraints

- **Слой 1 (сервис) → TDD обязателен.** Тест пишется первым, запускается и падает, и только потом появляется код.
- **Node ≥ 22.22.2**, ESM (`"type": "module"`), TypeScript strict. Импорты внутри воркспейса — без расширения `.js`, как в существующих файлах.
- **Тесты:** `npm test` из корня репозитория (vitest, `include: ["**/src/**/*.test.{ts,tsx}"]`). Типы: `npm run typecheck`. Оба должны быть зелёными перед каждым коммитом.
- **CI — ubuntu-latest**, поэтому картинка не имеет права зависеть от шрифтов конкретной машины: `loadSystemFonts: false` и шрифт из репозитория.
- **Никаких настоящих имён в фикстурах.** Репозиторий публичный, в нём есть сторож `server/src/db/no-real-names.test.ts`. Используй «Иванов Иван», «Петров Пётр», «Сидоров Сидор».
- **Идентификаторы — только латиница.** До этой работы в репозитории не было ни одного кириллического имени переменной или функции (`git grep -nE "(const|let|function) [а-яА-ЯёЁ]"` по всем тестам пуст). Русскими остаются только строки для человека и названия тестов в `it("...")`.
- **В `server/src/**` комментарии по-английски — и в коде, и в тестах.** Соседние файлы (`bot/bot.test.ts`, `repo/*.test.ts`) пишут пояснения по-английски, вставляя русские доменные термины в «ёлочках» внутри английской фразы. Блоки кода ниже приводят комментарии по-русски: **переводи их, сохраняя смысл целиком.** Это правило нарушалось трижды подряд именно в тестовых файлах — проверяй их наравне с реализацией.
- **Русские строки для человека.** В остальных пакетах комментарии — как в файле, который правишь: репозиторий смешанный намеренно (`shared/src/category.ts` и `shared/src/schedule-palette.ts` объясняют доменные решения по-русски, `shared/src/overlap.ts` и большая часть `server/src/bot/bot.ts` — по-английски). Язык комментария дефектом не считается.
- **Коммиты** — Conventional Commits с русским описанием (`feat(week): …`), в конце сообщения строка
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- **Не менять** поведение мини-аппа. Переезды кода в `shared/` делаются через реэкспорт, ни один компонент не переписывается; зелёный набор тестов мини-аппа — доказательство чистоты переезда.

---

## Структура файлов

**Создаются:**

| Файл | Ответственность |
| --- | --- |
| `shared/src/week-dates.ts` | Календарь недели: понедельник, сдвиг на дни, короткие названия дней, подпись диапазона. Чистые функции над `Date` и над строками `YYYY-MM-DD`. |
| `shared/src/week-dates.test.ts` | Тесты на них. |
| `shared/src/week-model.ts` | Модель сетки: какие записи в каких клетках, какая буква, какой цвет, и легенда под сеткой. |
| `shared/src/week-model.test.ts` | Тесты на модель. |
| `server/src/repo/team-schedule.ts` | `readTeamSchedule` — единственное место, где расписание команды урезается до безопасных полей и очищается от архивных. |
| `server/src/repo/team-schedule.test.ts` | Тесты на него. |
| `server/src/render/week-svg.ts` | Чистая функция «модель → SVG». Вся вёрстка картинки. |
| `server/src/render/week-svg.test.ts` | Тесты на вёрстку. |
| `server/src/render/rasterize.ts` | Тонкий адаптер SVG → PNG на resvg. |
| `server/src/render/rasterize.test.ts` | Тест на адаптер. |
| `server/src/bot/week-image.ts` | Сборка: расписание → модель → SVG → PNG + подпись. |
| `server/src/bot/week-image.test.ts` | Тесты на сборку. |
| `server/src/bot/week-command.test.ts` | Тесты команды и листания. |
| `server/assets/fonts/DejaVuSans.ttf`, `DejaVuSans-Bold.ttf`, `LICENSE-DejaVu.txt` | Шрифт картинки. |

**Меняются:**

| Файл | Что именно |
| --- | --- |
| `shared/src/index.ts` | Экспорт двух новых модулей. |
| `shared/src/schedule-palette.ts` | Переезжают палитры категорий из мини-аппа. |
| `miniapp/src/lib/week.ts` | Свои копии датовых хелперов заменяются реэкспортом из shared. |
| `miniapp/src/categories.tsx` | `LIGHT_PALETTE`/`DARK_PALETTE` заменяются реэкспортом из shared. |
| `miniapp/src/lib/team-schedule.ts` | Модель недели заменяется реэкспортом; своя копия подписей категорий удаляется. |
| `server/src/http/app.ts` | Роут `/api/team/schedule` начинает звать `readTeamSchedule`. |
| `server/src/bot/bot.ts` | Команда `/week`, обработчик листания, пункт меню. |
| `server/package.json` | Зависимость `@resvg/resvg-js`. |

---

## Task 1: Календарь недели переезжает в `shared/`

Серверу нужны те же «понедельник этой недели» и «Пн/Вт/Ср», что уже есть у мини-аппа. Второй копии быть не должно. Заодно добавляются строковые варианты (`…Iso`), чтобы на сервере вообще не появлялись объекты `Date` — иначе арифметика недель поедет за часовым поясом машины, а не команды.

**Files:**
- Create: `shared/src/week-dates.ts`
- Create: `shared/src/week-dates.test.ts`
- Modify: `shared/src/index.ts`
- Modify: `miniapp/src/lib/week.ts:8-9,26,31-67,124-127`

**Interfaces:**
- Consumes: ничего.
- Produces:
  ```ts
  export const WEEKDAY_SHORT_RU: readonly string[];          // ["Пн",…,"Вс"], индекс 0 = понедельник
  export function toISODate(d: Date): string;
  export function parseISODate(iso: string): Date;
  export function addDays(d: Date, days: number): Date;
  export function addDaysIso(iso: string, days: number): string;
  export function mondayOf(d: Date): Date;
  export function mondayOfIso(iso: string): string;
  export function weekdayIndex(iso: string): number;         // 0 = понедельник
  export function weekdayShort(iso: string): string;         // "Пн"
  export function formatWeekRangeLabel(monday: Date, sunday: Date): string;
  export function formatWeekRangeLabelIso(mondayIso: string, sundayIso: string): string;
  ```

- [ ] **Step 1: Написать падающий тест**

Создай `shared/src/week-dates.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  addDaysIso,
  formatWeekRangeLabelIso,
  mondayOfIso,
  weekdayShort,
} from "./week-dates";

describe("календарь недели", () => {
  it("mondayOfIso даёт понедельник той же недели", () => {
    expect(mondayOfIso("2026-08-06")).toBe("2026-08-03"); // четверг
    expect(mondayOfIso("2026-08-03")).toBe("2026-08-03"); // сам понедельник
    // Воскресенье — последний день той же недели, а не первый день следующей.
    expect(mondayOfIso("2026-08-09")).toBe("2026-08-03");
  });

  it("addDaysIso переходит через границу месяца и считает назад", () => {
    expect(addDaysIso("2026-08-31", 1)).toBe("2026-09-01");
    expect(addDaysIso("2026-08-03", -7)).toBe("2026-07-27");
    expect(addDaysIso("2026-08-03", 6)).toBe("2026-08-09");
  });

  it("weekdayShort нумерует с понедельника", () => {
    expect(weekdayShort("2026-08-03")).toBe("Пн");
    expect(weekdayShort("2026-08-09")).toBe("Вс");
  });

  it("formatWeekRangeLabelIso называет месяц словом", () => {
    // Точное тире зависит от версии ICU, поэтому проверяем смысл, а не байты.
    const label = formatWeekRangeLabelIso("2026-08-03", "2026-08-09");
    expect(label).toContain("3");
    expect(label).toContain("9");
    expect(label).toContain("август");
  });
});
```

- [ ] **Step 2: Запустить и убедиться, что падает**

Run: `npx vitest run shared/src/week-dates.test.ts`
Expected: FAIL — `Failed to resolve import "./week-dates"`.

- [ ] **Step 3: Создать модуль**

Создай `shared/src/week-dates.ts`. Тела `toISODate`/`parseISODate`/`addDays`/`mondayOf`/`weekdayIndex`/`weekdayShort`/`formatWeekRangeLabel` переносятся **дословно** из `miniapp/src/lib/week.ts` (строки 8-9, 26, 31-67, 124-127) — это переезд, не переписывание:

```ts
/**
 * Календарь недели: общий и для мини-аппа, и для картинки, которую рисует бот.
 *
 * Пары функций: над `Date` — для экранов, где дата уже разобрана, и над строками
 * `YYYY-MM-DD` (суффикс `Iso`) — для сервера, где объект `Date` затащил бы в
 * арифметику часовой пояс машины вместо часового пояса команды.
 */

/** Monday-first weekday abbreviations, index 0 = Monday. */
export const WEEKDAY_SHORT_RU: readonly string[] = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

const monthDayFormatter = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" });

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

/** Formats a local `Date` as "YYYY-MM-DD" (no timezone conversion). */
export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Parses a "YYYY-MM-DD" string as a local-midnight `Date`. */
export function parseISODate(iso: string): Date {
  const [y, m, day] = iso.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, day ?? 1);
}

export function addDays(d: Date, days: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + days);
  return copy;
}

/** Same, on the "YYYY-MM-DD" level — no `Date` ever escapes into caller code. */
export function addDaysIso(iso: string, days: number): string {
  return toISODate(addDays(parseISODate(iso), days));
}

/** Midnight Monday of the week containing `d` (ISO week start). */
export function mondayOf(d: Date): Date {
  const dow = d.getDay(); // 0 Sun .. 6 Sat
  const sinceMonday = (dow + 6) % 7;
  const monday = addDays(d, -sinceMonday);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

export function mondayOfIso(iso: string): string {
  return toISODate(mondayOf(parseISODate(iso)));
}

/** 0 = Monday .. 6 = Sunday, for a "YYYY-MM-DD" date. */
export function weekdayIndex(iso: string): number {
  return (parseISODate(iso).getDay() + 6) % 7;
}

export function weekdayShort(iso: string): string {
  return WEEKDAY_SHORT_RU[weekdayIndex(iso)] ?? "";
}

/** "13–19 июля" (or "28 июля – 3 августа" across a month boundary). */
export function formatWeekRangeLabel(monday: Date, sunday: Date): string {
  return monthDayFormatter.formatRange(monday, sunday);
}

export function formatWeekRangeLabelIso(mondayIso: string, sundayIso: string): string {
  return formatWeekRangeLabel(parseISODate(mondayIso), parseISODate(sundayIso));
}
```

- [ ] **Step 4: Экспортировать из пакета**

В `shared/src/index.ts` добавь строку после `export * from "./time";`:

```ts
export * from "./week-dates";
```

- [ ] **Step 5: Запустить тест — должен пройти**

Run: `npx vitest run shared/src/week-dates.test.ts`
Expected: PASS, 4 теста.

- [ ] **Step 6: Переключить мини-апп на реэкспорт**

В `miniapp/src/lib/week.ts` удали собственные `WEEKDAY_SHORT_RU`, `pad2`, `toISODate`, `parseISODate`, `addDays`, `mondayOf`, `weekdayIndex`, `weekdayShort`, `formatWeekRangeLabel` и вместо них поставь в начало файла (после комментария-шапки):

```ts
import {
  addDays,
  formatWeekRangeLabel,
  mondayOf,
  parseISODate,
  toISODate,
  weekdayIndex,
  weekdayShort,
  WEEKDAY_SHORT_RU,
} from "@planer/shared";

// Переехало в @planer/shared: тем же календарём сервер рисует картинку недели
// для бота, и расходиться две копии не должны.
export {
  addDays,
  formatWeekRangeLabel,
  mondayOf,
  parseISODate,
  toISODate,
  weekdayIndex,
  weekdayShort,
  WEEKDAY_SHORT_RU,
};
```

`monthDayFormatter`, `MONTH_SHORT_RU`, `formatShortDate`, `formatDayLabel`, `formatShortDateRange`, `isWeekendIso`, `dayOptions`, `isCurrentPeriod` остаются в мини-аппе без изменений — они нужны только экранам.

- [ ] **Step 7: Прогнать весь набор**

Run: `npm test && npm run typecheck`
Expected: PASS. Зелёный `miniapp/src/lib/week.test.ts` — доказательство, что переезд ничего не сломал.

- [ ] **Step 8: Коммит**

```bash
git add shared/src/week-dates.ts shared/src/week-dates.test.ts shared/src/index.ts miniapp/src/lib/week.ts
git commit -m "$(cat <<'EOF'
refactor(shared): календарь недели переезжает из мини-аппа в shared

Понедельник недели и короткие названия дней нужны серверу, чтобы рисовать
картинку недели для бота. Добавлены строковые варианты (mondayOfIso,
addDaysIso, formatWeekRangeLabelIso): на сервере объект Date затащил бы в
арифметику часовой пояс машины вместо часового пояса команды.

Мини-апп реэкспортирует переехавшее, ни один экран не изменился.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Палитры категорий переезжают в `shared/`

Записи без пресета (произвольные времена, больничный, командировка) красятся по категории, и эта таблица сейчас живёт только в мини-аппе. Картинке она нужна для той же клетки и той же строки легенды.

**Files:**
- Modify: `shared/src/schedule-palette.ts` (добавить в конец)
- Modify: `shared/src/schedule-palette.test.ts` (добавить блок)
- Modify: `miniapp/src/categories.tsx:23-58`
- Modify: `admin/src/categories.tsx:30-56`

Копий этой таблицы в репозитории две, а не одна: `admin/src/categories.tsx`
держит побайтово такую же и честно признаётся в комментарии — «Mirrors
miniapp/src/categories.tsx so the two apps read consistently». Ручное зеркало
существовало потому, что общего места не было; теперь оно есть, и обе копии
уходят в него.

**Interfaces:**
- Consumes: `EntryCategory` из `shared/src/category.ts`.
- Produces:
  ```ts
  export interface CategoryPalette { readonly bg: string; readonly fg: string }
  export const CATEGORY_PALETTES_LIGHT: Record<EntryCategory, CategoryPalette>;
  export const CATEGORY_PALETTES_DARK: Record<EntryCategory, CategoryPalette>;
  export function categoryPalette(category: EntryCategory, isDark: boolean): CategoryPalette;
  ```

- [ ] **Step 1: Написать падающий тест**

Добавь в конец `shared/src/schedule-palette.test.ts`:

```ts
import { CATEGORY_PALETTES_DARK, CATEGORY_PALETTES_LIGHT, categoryPalette } from "./schedule-palette";
import { entryCategorySchema } from "./category";

describe("палитра категорий", () => {
  it("покрывает каждую категорию в обеих темах", () => {
    for (const category of entryCategorySchema.options) {
      expect(CATEGORY_PALETTES_LIGHT[category], category).toBeDefined();
      expect(CATEGORY_PALETTES_DARK[category], category).toBeDefined();
    }
  });

  it("отпуск берёт свой точный цвет, а не категорийный", () => {
    // exactSchedulePalette знает отпуск в лицо — «О» на красном; категорийная
    // амбра сюда попасть не должна ни в светлой теме, ни в тёмной.
    expect(categoryPalette("vacation", false).bg).toBe("#FD0100");
    expect(categoryPalette("vacation", true).bg).toBe("#FD0100");
  });

  it("остальные категории различаются по теме", () => {
    expect(categoryPalette("shift", false)).not.toEqual(categoryPalette("shift", true));
  });
});
```

Если в файле уже есть строка `import { describe, it, expect } from "vitest";` — не дублируй её, а импорты из `./schedule-palette` слей с существующим импортом.

- [ ] **Step 2: Запустить и убедиться, что падает**

Run: `npx vitest run shared/src/schedule-palette.test.ts`
Expected: FAIL — `CATEGORY_PALETTES_LIGHT` не экспортируется.

- [ ] **Step 3: Перенести таблицы**

Добавь в конец `shared/src/schedule-palette.ts` (значения переносятся **дословно** из `miniapp/src/categories.tsx:23-48`):

```ts
export interface CategoryPalette {
  readonly bg: string;
  readonly fg: string;
}

// Chip background/foreground pairs, tuned separately per theme so every
// category stays legible on both a near-white and a near-black canvas.
export const CATEGORY_PALETTES_LIGHT: Record<EntryCategory, CategoryPalette> = {
  shift: { bg: "#E3EFFC", fg: "#144F8F" }, // Telegram blue
  vacation: { bg: "#FCEEDA", fg: "#714700" }, // amber
  sick_leave: { bg: "#FCE4E4", fg: "#931F19" }, // rose
  duty: { bg: "#DEF5F0", fg: "#095A51" }, // teal
  offsite: { bg: "#EEE6FB", fg: "#622CAC" }, // violet
  business_trip: { bg: "#E4E6FA", fg: "#373FA6" }, // indigo
  weekend_work: { bg: "#E1F6E1", fg: "#185D28" }, // green
};

export const CATEGORY_PALETTES_DARK: Record<EntryCategory, CategoryPalette> = {
  shift: { bg: "rgba(64,150,238,0.24)", fg: "#8EC9FF" },
  vacation: { bg: "rgba(240,170,60,0.22)", fg: "#F4C169" },
  sick_leave: { bg: "rgba(230,80,60,0.24)", fg: "#F5A296" },
  duty: { bg: "rgba(48,191,171,0.22)", fg: "#5FE0CB" },
  offsite: { bg: "rgba(160,110,235,0.24)", fg: "#C4A4F5" },
  business_trip: { bg: "rgba(102,112,225,0.24)", fg: "#AEB4F7" },
  weekend_work: { bg: "rgba(70,190,90,0.22)", fg: "#86E093" },
};

/**
 * Цвет записи для конкретной темы: точный цвет пресета, если он есть, иначе
 * цвет категории. Картинка бота зовёт это со `isDark: false` — у PNG нет темы,
 * а светлый вариант читается и в тёмном чате.
 */
export function categoryPalette(category: EntryCategory, isDark: boolean): CategoryPalette {
  const exact = exactSchedulePalette(undefined, category);
  if (exact) return { bg: exact.bg, fg: exact.fg };
  return (isDark ? CATEGORY_PALETTES_DARK : CATEGORY_PALETTES_LIGHT)[category];
}
```

Проверь, что `EntryCategory` уже импортирован в шапке файла (он там есть: `import type { EntryCategory, TemplateAccent } from "./category";`).

- [ ] **Step 4: Запустить тест — должен пройти**

Run: `npx vitest run shared/src/schedule-palette.test.ts`
Expected: PASS.

- [ ] **Step 5: Переключить мини-апп на реэкспорт**

В `miniapp/src/categories.tsx` удали локальные `CategoryPalette`, `LIGHT_PALETTE`, `DARK_PALETTE` и тело `categoryPaletteForTheme`, заменив на реэкспорт. Импорт из shared в шапке файла расширь:

```ts
import {
  categoryPalette,
  exactSchedulePalette,
  UNRECOGNISED_SCHEDULE_PALETTE,
  type CategoryPalette,
  type EntryCategory,
  type TemplateAccent,
} from "@planer/shared";

export type { CategoryPalette };

/**
 * Resolves the existing category colour for an explicit Telegram appearance.
 *
 * Таблица переехала в @planer/shared: теми же цветами сервер красит клетки
 * картинки недели для бота, и разъезжаться копии не должны.
 */
export function categoryPaletteForTheme(category: Category, isDark: boolean): CategoryPalette {
  return categoryPalette(category, isDark);
}
```

`useEntryPalette`, `categoryLabel`, `CategoryChip` и всё остальное в файле не трогай.

- [ ] **Step 6: То же самое в админке**

`admin/src/categories.tsx` держит побайтово ту же пару таблиц (строки 30-56), и комментарий над ними прямо говорит, что это ручное зеркало мини-аппа. Удали локальные `CategoryPalette`, `LIGHT_PALETTE`, `DARK_PALETTE` и перепиши `useCategoryPalette`/`useEntryPalette` на `categoryPalette` из `@planer/shared` — ровно так же, как в мини-аппе, сохранив имена и сигнатуры всех экспортов файла. Админка уже зависит от `@planer/shared` (он импортируется в девяти её файлах), новой зависимости не появляется.

Если у админки своя функция разрешения темы (`useIsDark` или аналог) — она остаётся, меняется только источник таблицы.

- [ ] **Step 7: Прогнать весь набор**

Run: `npm test && npm run typecheck`
Expected: PASS. Тесты админки (`admin/src/**`) зелёные без правок — доказательство, что цвета не поехали.

- [ ] **Step 8: Коммит**

```bash
git add shared/src/schedule-palette.ts shared/src/schedule-palette.test.ts miniapp/src/categories.tsx admin/src/categories.tsx
git commit -m "$(cat <<'EOF'
refactor(shared): палитры категорий переезжают в shared из обеих админок

Записи без пресета красятся по категории, и эта таблица нужна серверу, чтобы
красить клетки картинки недели теми же цветами, что видит человек на экране.

Копий было две: admin держал побайтово такую же и признавался в комментарии, что
это ручное зеркало мини-аппа. Зеркало существовало из-за отсутствия общего места
— теперь оно есть.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Модель недели переезжает в `shared/`

Самая объёмная часть. Функции переносятся дословно; меняются только две вещи: типы становятся структурными (чтобы подходили и строки БД, и JSON из API), а дни недели считаются строковой арифметикой вместо `new Date(...T12:00:00)`.

**Files:**
- Create: `shared/src/week-model.ts`
- Create: `shared/src/week-model.test.ts`
- Modify: `shared/src/index.ts`
- Modify: `miniapp/src/lib/team-schedule.ts:1-10,54-82,88-91,108-138,240-349`

**Interfaces:**
- Consumes: `categoryLabel`, `EntryCategory`, `TemplateAccent` (`shared/src/category.ts`); `exactSchedulePalette`, `UNRECOGNISED_SCHEDULE_PALETTE`, `SchedulePalette` (`shared/src/schedule-palette.ts`); `addDaysIso` (Task 1).
- Produces:
  ```ts
  export interface ScheduleEntryLike {
    employeeId: number | null;
    date: string;
    endDate: string | null;
    start: string | null;
    end: string | null;
    category: EntryCategory;
    title: string | null;
    templateId: number | null;
    unrecognisedCode?: string | null;
  }
  export interface SchedulePresetLike { id: number; name: string; accent: TemplateAccent; sortOrder: number }
  export interface TeamMemberLike { id: number; displayName: string; rosterOrder: number | null }

  export interface TeamEntryView<E extends ScheduleEntryLike = ScheduleEntryLike> {
    shift: E; title: string; palette: SchedulePalette | null;
  }
  export interface WeekCell<E extends ScheduleEntryLike = ScheduleEntryLike> {
    date: string; entries: TeamEntryView<E>[]; primary: TeamEntryView<E> | null; extraCount: number;
  }
  export interface WeekRow<E extends ScheduleEntryLike = ScheduleEntryLike> {
    employeeId: number | null; displayName: string; cells: WeekCell<E>[];
  }
  export interface WeekModel<E extends ScheduleEntryLike = ScheduleEntryLike> {
    days: string[]; rows: WeekRow<E>[];
  }
  export interface WeekLegendItem {
    code: string; label: string; palette: SchedulePalette | null; category: EntryCategory | null;
  }

  export function coversDate(shift: ScheduleEntryLike, date: string): boolean;
  export function splitDisplayName(displayName: string): { surname: string; rest: string };
  export function templateFor<E extends ScheduleEntryLike>(shift: E, templates: readonly SchedulePresetLike[]): SchedulePresetLike | undefined;
  export function toEntryView<E extends ScheduleEntryLike>(shift: E, templates: readonly SchedulePresetLike[]): TeamEntryView<E>;
  export function compareShifts<E extends ScheduleEntryLike>(a: E, b: E, templates: readonly SchedulePresetLike[]): number;
  export function buildWeekModel<E extends ScheduleEntryLike>(
    mondayIso: string,
    schedule: { employees: readonly TeamMemberLike[]; shifts: readonly E[] },
    templates: readonly SchedulePresetLike[],
  ): WeekModel<E>;
  export function buildWeekLegend(model: WeekModel<ScheduleEntryLike>): WeekLegendItem[];
  ```

- [ ] **Step 1: Написать падающий тест**

Создай `shared/src/week-model.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildWeekLegend, buildWeekModel, splitDisplayName, type ScheduleEntryLike, type SchedulePresetLike } from "./week-model";

const MONDAY = "2026-08-03";

const PRESETS: SchedulePresetLike[] = [
  { id: 1, name: "День", accent: "blue", sortOrder: 1 },
  { id: 2, name: "Ночь", accent: "indigo", sortOrder: 2 },
];

function entry(over: Partial<ScheduleEntryLike> & { date: string }): ScheduleEntryLike {
  return {
    employeeId: 1,
    endDate: null,
    start: "08:00",
    end: "20:00",
    category: "shift",
    title: null,
    templateId: 1,
    unrecognisedCode: null,
    ...over,
  };
}

const TEAM = [
  { id: 1, displayName: "Иванов Иван", rosterOrder: 0 },
  { id: 2, displayName: "Петров Пётр", rosterOrder: 1 },
];

describe("модель недели", () => {
  it("строит семь дней от понедельника", () => {
    const model = buildWeekModel(MONDAY, { employees: TEAM, shifts: [] }, PRESETS);
    expect(model.days).toEqual([
      "2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06",
      "2026-08-07", "2026-08-08", "2026-08-09",
    ]);
  });

  it("даёт по строке на человека в порядке ростера", () => {
    const model = buildWeekModel(MONDAY, { employees: [TEAM[1]!, TEAM[0]!], shifts: [] }, PRESETS);
    expect(model.rows.map((row) => row.displayName)).toEqual(["Иванов Иван", "Петров Пётр"]);
  });

  it("кладёт запись в свою клетку и берёт цвет пресета", () => {
    const model = buildWeekModel(MONDAY, { employees: TEAM, shifts: [entry({ date: "2026-08-05" })] }, PRESETS);
    const cell = model.rows[0]!.cells[2]!;
    expect(cell.primary?.palette?.code).toBe("Д");
    expect(cell.primary?.title).toBe("День");
    expect(model.rows[0]!.cells[0]!.primary).toBeNull();
  });

  it("растягивает многодневный отпуск на все его дни", () => {
    const vacation = entry({
      date: "2026-08-04", endDate: "2026-08-06", start: null, end: null,
      category: "vacation", templateId: null,
    });
    const model = buildWeekModel(MONDAY, { employees: TEAM, shifts: [vacation] }, PRESETS);
    const codes = model.rows[0]!.cells.map((cell) => cell.primary?.palette?.code ?? null);
    expect(codes).toEqual([null, "О", "О", "О", null, null, null]);
  });

  it("вторая запись в клетке уходит в +N", () => {
    const shifts = [entry({ date: "2026-08-03" }), entry({ date: "2026-08-03", templateId: 2, start: "20:00", end: "08:00" })];
    const model = buildWeekModel(MONDAY, { employees: TEAM, shifts }, PRESETS);
    const cell = model.rows[0]!.cells[0]!;
    expect(cell.primary?.palette?.code).toBe("Д"); // раньше по времени
    expect(cell.extraCount).toBe(1);
  });

  it("строка «Не назначено» появляется только когда есть ничейная смена", () => {
    const withoutUnassigned = buildWeekModel(MONDAY, { employees: TEAM, shifts: [] }, PRESETS);
    expect(withoutUnassigned.rows.map((row) => row.employeeId)).toEqual([1, 2]);

    const withUnassigned = buildWeekModel(
      MONDAY,
      { employees: TEAM, shifts: [entry({ date: "2026-08-05", employeeId: null })] },
      PRESETS,
    );
    expect(withUnassigned.rows.at(-1)!.employeeId).toBeNull();
    expect(withUnassigned.rows.at(-1)!.displayName).toBe("Не назначено");
  });

  it("нераспознанная клетка говорит об этом словами и своим серым", () => {
    const shifts = [entry({ date: "2026-08-03", templateId: null, unrecognisedCode: "Ко" })];
    const model = buildWeekModel(MONDAY, { employees: TEAM, shifts }, PRESETS);
    const view = model.rows[0]!.cells[0]!.primary!;
    expect(view.palette?.code).toBe("?");
    expect(view.title).toContain("Ко");
  });

  it("легенда перечисляет только те буквы, что нарисованы", () => {
    const shifts = [entry({ date: "2026-08-03" }), entry({ date: "2026-08-04" })];
    const model = buildWeekModel(MONDAY, { employees: TEAM, shifts }, PRESETS);
    const legend = buildWeekLegend(model);
    expect(legend).toHaveLength(1);
    expect(legend[0]!.code).toBe("Д");
    expect(legend[0]!.label).toBe("День");
  });

  it("splitDisplayName отделяет фамилию от остального", () => {
    expect(splitDisplayName("Иванов Иван Иванович")).toEqual({ surname: "Иванов", rest: "Иван Иванович" });
    expect(splitDisplayName("Иванов")).toEqual({ surname: "Иванов", rest: "" });
  });
});
```

- [ ] **Step 2: Запустить и убедиться, что падает**

Run: `npx vitest run shared/src/week-model.test.ts`
Expected: FAIL — `Failed to resolve import "./week-model"`.

- [ ] **Step 3: Создать модуль**

Создай `shared/src/week-model.ts`. Логика функций переносится **дословно** из `miniapp/src/lib/team-schedule.ts` (строки 54-82, 88-91, 108-138, 240-349); отличия ровно два, оба отмечены комментариями в коде ниже.

```ts
import { categoryLabel, type EntryCategory, type TemplateAccent } from "./category";
import {
  exactSchedulePalette,
  UNRECOGNISED_SCHEDULE_PALETTE,
  type SchedulePalette,
} from "./schedule-palette";
import { addDaysIso } from "./week-dates";

/**
 * Сетка «команда × неделя»: какая запись попадает в какую клетку, какой буквой
 * и каким цветом рисуется, и что написать под сеткой.
 *
 * Живёт в shared, потому что этим заняты двое: экран «Команда → Неделя» в
 * мини-аппе и картинка, которую бот присылает по /week. Двух реализаций быть не
 * может — они разъедутся по буквам и цветам, причём молча.
 *
 * Типы входа структурные, а не импортированные из мини-аппа: одна и та же
 * функция получает то строку из БД, то разобранный JSON, и требовать от них
 * общий номинальный тип значило бы гонять данные через конвертер впустую.
 */
export interface ScheduleEntryLike {
  employeeId: number | null;
  date: string;
  endDate: string | null;
  start: string | null;
  end: string | null;
  category: EntryCategory;
  title: string | null;
  templateId: number | null;
  unrecognisedCode?: string | null;
}

/** Минимум пресета: сетка берёт из него имя, цвет и порядок сортировки. */
export interface SchedulePresetLike {
  id: number;
  name: string;
  accent: TemplateAccent;
  sortOrder: number;
}

/** Минимум человека: одна строка сетки. */
export interface TeamMemberLike {
  id: number;
  displayName: string;
  rosterOrder: number | null;
}

export interface TeamEntryView<E extends ScheduleEntryLike = ScheduleEntryLike> {
  shift: E;
  title: string;
  palette: SchedulePalette | null;
}

export interface WeekCell<E extends ScheduleEntryLike = ScheduleEntryLike> {
  date: string;
  entries: TeamEntryView<E>[];
  primary: TeamEntryView<E> | null;
  extraCount: number;
}

export interface WeekRow<E extends ScheduleEntryLike = ScheduleEntryLike> {
  employeeId: number | null;
  displayName: string;
  cells: WeekCell<E>[];
}

export interface WeekModel<E extends ScheduleEntryLike = ScheduleEntryLike> {
  days: string[];
  rows: WeekRow<E>[];
}

export function coversDate(shift: ScheduleEntryLike, date: string): boolean {
  return shift.date <= date && (shift.endDate ?? shift.date) >= date;
}

export function splitDisplayName(displayName: string): { surname: string; rest: string } {
  const [surname = displayName, ...rest] = displayName.trim().split(/\s+/);
  return { surname, rest: rest.join(" ") };
}

export function templateFor<E extends ScheduleEntryLike>(
  shift: E,
  templates: readonly SchedulePresetLike[],
): SchedulePresetLike | undefined {
  return shift.templateId == null
    ? undefined
    : templates.find((template) => template.id === shift.templateId);
}

export function toEntryView<E extends ScheduleEntryLike>(
  shift: E,
  templates: readonly SchedulePresetLike[],
): TeamEntryView<E> {
  const template = templateFor(shift, templates);
  // A cell the import could not read keeps its own grey «?» square and says so in
  // words — «Смена» would claim we know what it is, and we do not.
  if (shift.unrecognisedCode) {
    return { shift, title: `Не распознано: «${shift.unrecognisedCode}»`, palette: UNRECOGNISED_SCHEDULE_PALETTE };
  }
  return {
    shift,
    // Отличие от копии в мини-аппе: подпись категории берётся из categoryLabel,
    // а не из третьей копии той же таблицы.
    title: template?.name ?? shift.title ?? categoryLabel(shift.category),
    palette: exactSchedulePalette(template?.accent, shift.category),
  };
}

export function compareShifts<E extends ScheduleEntryLike>(
  a: E,
  b: E,
  templates: readonly SchedulePresetLike[],
): number {
  const byStart = (a.start ?? "99:99").localeCompare(b.start ?? "99:99");
  if (byStart !== 0) return byStart;
  const aOrder = templateFor(a, templates)?.sortOrder ?? Number.MAX_SAFE_INTEGER;
  const bOrder = templateFor(b, templates)?.sortOrder ?? Number.MAX_SAFE_INTEGER;
  if (aOrder !== bOrder) return aOrder - bOrder;
  return toEntryView(a, templates).title.localeCompare(toEntryView(b, templates).title, "ru");
}

function weekCell<E extends ScheduleEntryLike>(
  date: string,
  employeeId: number | null,
  shifts: readonly E[],
  templates: readonly SchedulePresetLike[],
): WeekCell<E> {
  const entries = shifts
    .filter((shift) => shift.employeeId === employeeId && coversDate(shift, date))
    .sort((a, b) => compareShifts(a, b, templates))
    .map((shift) => toEntryView(shift, templates));
  return {
    date,
    entries,
    primary: entries[0] ?? null,
    extraCount: Math.max(0, entries.length - 1),
  };
}

export function buildWeekModel<E extends ScheduleEntryLike>(
  mondayIso: string,
  schedule: { employees: readonly TeamMemberLike[]; shifts: readonly E[] },
  templates: readonly SchedulePresetLike[],
): WeekModel<E> {
  // Отличие от копии в мини-аппе: дни считаются строковой арифметикой, а не
  // через `new Date(iso + "T12:00:00")`. Результат тот же, но на сервере в
  // расчёт не попадает часовой пояс машины.
  const days = Array.from({ length: 7 }, (_, index) => addDaysIso(mondayIso, index));
  const employees = [...schedule.employees].sort((a, b) => {
    const aOrder = a.rosterOrder ?? Number.MAX_SAFE_INTEGER;
    const bOrder = b.rosterOrder ?? Number.MAX_SAFE_INTEGER;
    return aOrder - bOrder || a.id - b.id;
  });
  const rows: WeekRow<E>[] = employees.map((employee) => ({
    employeeId: employee.id,
    displayName: employee.displayName,
    cells: days.map((date) => weekCell(date, employee.id, schedule.shifts, templates)),
  }));
  if (
    schedule.shifts.some(
      (shift) => shift.employeeId == null && days.some((date) => coversDate(shift, date)),
    )
  ) {
    rows.push({
      employeeId: null,
      displayName: "Не назначено",
      cells: days.map((date) => weekCell(date, null, schedule.shifts, templates)),
    });
  }
  return { days, rows };
}

/** One entry in the week grid's key: the coloured square, and what it stands for. */
export interface WeekLegendItem {
  /** The letter drawn in the cell — «У», «Н», «ВА», «07», or «•» for a one-off. */
  code: string;
  /** What that letter means, in the preset's own words. */
  label: string;
  /** The preset's exact colours, or null when the cell falls back to its category's —
   *  those depend on the theme, so the consumer resolves them the same way the grid does. */
  palette: SchedulePalette | null;
  /** Only set alongside a null palette: which category's colour the cell used. */
  category: EntryCategory | null;
}

/** A one-off entry with no preset behind it; the grid draws it as a dot. */
const FALLBACK_LEGEND_CODE = "•";

/**
 * The key for a week grid, built from the week actually on screen rather than from
 * a fixed list of presets. A single letter in a coloured square is unguessable —
 * «П» is Поклонка and «Т» is Телефон, and nothing on the screen said so.
 *
 * Only the squares that are drawn count: a cell shows its primary entry and hides
 * the rest behind «+N», so listing those would explain colours nobody can see.
 */
export function buildWeekLegend(model: WeekModel<ScheduleEntryLike>): WeekLegendItem[] {
  const seen = new Map<string, { item: WeekLegendItem; titles: Set<string> }>();
  for (const row of model.rows) {
    for (const cell of row.cells) {
      const entry = cell.primary;
      if (!entry) continue;
      const key = entry.palette ? entry.palette.code : `${FALLBACK_LEGEND_CODE}:${entry.shift.category}`;
      const existing = seen.get(key);
      if (existing) {
        existing.titles.add(entry.title);
        continue;
      }
      seen.set(key, {
        item: {
          code: entry.palette?.code ?? FALLBACK_LEGEND_CODE,
          label: entry.title,
          palette: entry.palette,
          category: entry.palette ? null : entry.shift.category,
        },
        titles: new Set([entry.title]),
      });
    }
  }
  return [...seen.values()]
    .map(({ item, titles }) => ({ ...item, label: [...titles].sort((a, b) => a.localeCompare(b, "ru")).join(" · ") }))
    // The presetless ones are the catch-all, so they read last however the week is shaped.
    .sort(
      (a, b) =>
        (a.palette ? 0 : 1) - (b.palette ? 0 : 1) || a.label.localeCompare(b.label, "ru"),
    );
}
```

- [ ] **Step 4: Экспортировать из пакета**

В `shared/src/index.ts` добавь после строки с `week-dates`:

```ts
export * from "./week-model";
```

- [ ] **Step 5: Запустить тест — должен пройти**

Run: `npx vitest run shared/src/week-model.test.ts`
Expected: PASS, 9 тестов.

- [ ] **Step 6: Переключить мини-апп на реэкспорт**

В `miniapp/src/lib/team-schedule.ts`:

1. Удали локальные `CATEGORY_TITLES`, `coversDate`, `splitDisplayName`, `templateFor`, `toEntryView`, `compareShifts`, `weekCell`, `buildWeekModel`, `buildWeekLegend`, а также типы `TeamEntryView`, `WeekCell`, `WeekRow`, `WeekModel`, `WeekLegendItem`.
2. Расширь импорт из shared и добавь реэкспорт:

```ts
import {
  buildWeekLegend,
  buildWeekModel,
  compareShifts,
  coversDate,
  isAbsence,
  splitDisplayName,
  toEntryView,
  type ScheduleEntryLike,
  type SchedulePresetLike,
  type TeamEntryView as SharedTeamEntryView,
  type WeekCell as SharedWeekCell,
  type WeekLegendItem,
  type WeekModel as SharedWeekModel,
  type WeekRow as SharedWeekRow,
} from "@planer/shared";
import type { Shift, TeamEmployee, TeamSchedule, Template } from "../api/client";

// Сетка недели переехала в @planer/shared: ею же сервер рисует картинку для
// бота. Здесь остаются только псевдонимы под конкретный `Shift` мини-аппа,
// чтобы компоненты не переписывать.
export { buildWeekLegend, buildWeekModel, compareShifts, coversDate, splitDisplayName, toEntryView };
export type { WeekLegendItem };
export type TeamEntryView = SharedTeamEntryView<Shift>;
export type WeekCell = SharedWeekCell<Shift>;
export type WeekRow = SharedWeekRow<Shift>;
export type WeekModel = SharedWeekModel<Shift>;
```

3. `type ScheduleTemplate = Pick<Template, "id" | "name" | "accent" | "sortOrder">` замени на `type ScheduleTemplate = SchedulePresetLike;`.
4. `buildTodayModel`, `groupEntries`, `groupingKey`, `personFor`, `employeeRank`, `teamRange`, `moveTeamDate` и весь блок `TeamScreenState` остаются на месте — они зовут `toEntryView`/`compareShifts`/`coversDate` уже из shared.

- [ ] **Step 7: Прогнать весь набор**

Run: `npm test && npm run typecheck`
Expected: PASS. Особенно важны `miniapp/src/lib/team-schedule.test.ts` и экранные тесты `miniapp/src/screens/team/*` — они и есть доказательство, что переезд чистый.

Если typecheck ругается на несовместимость `Shift` из `api/client.ts` со `ScheduleEntryLike` — сравни списки полей: в `ScheduleEntryLike` должны быть ровно `employeeId, date, endDate, start, end, category, title, templateId, unrecognisedCode`. Лишние поля у `Shift` (например `id`, `location`) совместимости не мешают, недостающие — мешают.

- [ ] **Step 8: Коммит**

```bash
git add shared/src/week-model.ts shared/src/week-model.test.ts shared/src/index.ts miniapp/src/lib/team-schedule.ts
git commit -m "$(cat <<'EOF'
refactor(shared): модель недели переезжает из мини-аппа в shared

Какая запись в какой клетке, какой буквой и каким цветом — этим теперь заняты
двое: экран «Команда → Неделя» и картинка, которую бот шлёт по /week. Двух
реализаций быть не может, они разъедутся молча.

Типы входа сделаны структурными, чтобы подходили и строка из БД, и JSON из API.
Дни недели считаются строковой арифметикой: на сервере new Date затащил бы в
расчёт часовой пояс машины. Третья копия подписей категорий удалена в пользу
categoryLabel из shared.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Один шейпер расписания на роут и на картинку

`GET /api/team/schedule` не просто отдаёт строки: он выбрасывает смены архивных сотрудников и урезает поля до безопасных (`note` — админское поле). Картинка обязана показывать ровно то же, поэтому логика переезжает в функцию, которую зовут оба.

**Files:**
- Create: `server/src/repo/team-schedule.ts`
- Create: `server/src/repo/team-schedule.test.ts`
- Modify: `server/src/http/app.ts:314-357`

**Interfaces:**
- Consumes: `listActiveInRosterOrder` (`server/src/repo/employees.ts`), `listShiftsOverlapping` (`server/src/repo/shifts.ts`).
- Produces:
  ```ts
  export interface TeamScheduleEntry {
    id: number; date: string; start: string | null; end: string | null; endDate: string | null;
    category: EntryCategory; title: string | null; location: string | null;
    unrecognisedCode: string | null; templateId: number | null; employeeId: number | null;
  }
  export interface TeamScheduleView {
    employees: { id: number; displayName: string; rosterOrder: number | null }[];
    shifts: TeamScheduleEntry[];
  }
  export function readTeamSchedule(db: Db, from: string, to: string): TeamScheduleView;
  ```

- [ ] **Step 1: Написать падающий тест**

Создай `server/src/repo/team-schedule.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { makeTestDb } from "../db/testdb";
import { createEmployee, archiveEmployee } from "./employees";
import { createShift } from "./shifts";
import { readTeamSchedule } from "./team-schedule";

describe("readTeamSchedule", () => {
  it("отдаёт активных людей и их смены за окно", () => {
    const db = makeTestDb();
    const ivanov = createEmployee(db, { displayName: "Иванов Иван" });
    createShift(db, { employeeId: ivanov.id, date: "2026-08-05", start: "08:00", end: "20:00", category: "shift" });

    const view = readTeamSchedule(db, "2026-08-03", "2026-08-09");

    expect(view.employees.map((e) => e.displayName)).toEqual(["Иванов Иван"]);
    expect(view.shifts).toHaveLength(1);
    expect(view.shifts[0]!.date).toBe("2026-08-05");
  });

  it("не отдаёт смены архивных — их некуда рисовать", () => {
    const db = makeTestDb();
    const ушедший = createEmployee(db, { displayName: "Петров Пётр" });
    createShift(db, { employeeId: ушедший.id, date: "2026-08-05", start: "08:00", end: "20:00", category: "shift" });
    // Третий аргумент обязателен: архивирование снимает человека со смен только
    // начиная с этой даты. Дата взята ПОСЛЕ смены нарочно — тогда смена остаётся
    // за архивным, и это ровно тот случай, который сетке нечем нарисовать:
    // строки у человека уже нет. Архивируй мы датой раньше смены, она стала бы
    // ничейной, и тест проверял бы совсем другое.
    archiveEmployee(db, ушедший.id, "2026-08-06");

    const view = readTeamSchedule(db, "2026-08-03", "2026-08-09");

    expect(view.employees).toHaveLength(0);
    expect(view.shifts).toHaveLength(0);
  });

  it("берёт только своё окно и не задевает соседние недели", () => {
    const db = makeTestDb();
    const ivanov = createEmployee(db, { displayName: "Иванов Иван" });
    for (const date of ["2026-08-02", "2026-08-05", "2026-08-10"]) {
      createShift(db, { employeeId: ivanov.id, date, start: "08:00", end: "20:00", category: "shift" });
    }

    const view = readTeamSchedule(db, "2026-08-03", "2026-08-09");

    expect(view.shifts.map((shift) => shift.date)).toEqual(["2026-08-05"]);
  });

  it("тянет многодневный отпуск, начавшийся до окна", () => {
    const db = makeTestDb();
    const ivanov = createEmployee(db, { displayName: "Иванов Иван" });
    createShift(db, { employeeId: ivanov.id, date: "2026-07-28", endDate: "2026-08-05", category: "vacation" });

    const view = readTeamSchedule(db, "2026-08-03", "2026-08-09");

    // Отпуск начался в прошлой неделе, но три её дня закрывает — выпасть он не
    // имеет права. Это и есть причина, по которой здесь listShiftsOverlapping,
    // а не listShiftsInRange.
    expect(view.shifts).toHaveLength(1);
  });

  it("оставляет ничейные смены — им отведена своя строка", () => {
    const db = makeTestDb();
    createEmployee(db, { displayName: "Иванов Иван" });
    createShift(db, { employeeId: null, date: "2026-08-05", start: "08:00", end: "20:00", category: "shift" });

    const view = readTeamSchedule(db, "2026-08-03", "2026-08-09");

    expect(view.shifts).toHaveLength(1);
    expect(view.shifts[0]!.employeeId).toBeNull();
  });

  it("не отдаёт админскую заметку", () => {
    const db = makeTestDb();
    const ivanov = createEmployee(db, { displayName: "Иванов Иван" });
    createShift(db, {
      employeeId: ivanov.id, date: "2026-08-05", start: "08:00", end: "20:00",
      category: "shift", note: "внутренняя пометка",
    });

    const view = readTeamSchedule(db, "2026-08-03", "2026-08-09");

    expect(JSON.stringify(view)).not.toContain("внутренняя пометка");
  });
});
```

Сигнатуры, на которые опирается тест (проверены по коду):

```ts
createEmployee(db, { displayName: string; inviteToken?: string; isAdmin?: boolean }): Employee
createShift(db, data: NewShift): Shift          // обязателен только `date`; category по умолчанию "shift"
archiveEmployee(db, id: number, fromDate: string): Employee | undefined
makeTestDb(): Db                                 // in-memory, миграции уже прогнаны
```

- [ ] **Step 2: Запустить и убедиться, что падает**

Run: `npx vitest run server/src/repo/team-schedule.test.ts`
Expected: FAIL — `Failed to resolve import "./team-schedule"`.

- [ ] **Step 3: Создать модуль**

Создай `server/src/repo/team-schedule.ts`. Тело переносится из `server/src/http/app.ts:337-357` **без изменений логики**:

```ts
import type { Db } from "../db/client";
import type { EntryCategory } from "@planer/shared";
import { listActiveInRosterOrder } from "./employees";
import { listShiftsOverlapping } from "./shifts";

/** Запись расписания в том виде, в каком её можно показывать любому работнику. */
export interface TeamScheduleEntry {
  id: number;
  date: string;
  start: string | null;
  end: string | null;
  endDate: string | null;
  category: EntryCategory;
  title: string | null;
  location: string | null;
  unrecognisedCode: string | null;
  templateId: number | null;
  employeeId: number | null;
}

export interface TeamScheduleView {
  employees: { id: number; displayName: string; rosterOrder: number | null }[];
  shifts: TeamScheduleEntry[];
}

/**
 * Расписание команды за окно дат — один источник и для `/api/team/schedule`, и
 * для картинки недели, которую бот шлёт по `/week`.
 *
 * Две вещи, ради которых это не «просто select»:
 *
 * 1. Архивирование снимает человека со смен только начиная с даты архива, так
 *    что прошлые за ним остаются — это настоящая история, и отчёты её читают.
 *    Но сетку рисуют по активным людям, поэтому такая запись не может попасть
 *    ни в одну строку: раньше она доезжала до клиента только чтобы там быть
 *    выброшенной.
 * 2. `note` — свободное админское поле, и за пределами админских экранов его
 *    никто читать не должен. Поэтому здесь именно перечисление полей, а не
 *    сырая строка.
 */
export function readTeamSchedule(db: Db, from: string, to: string): TeamScheduleView {
  const active = listActiveInRosterOrder(db);
  const employees = active.map((employee) => ({
    id: employee.id,
    displayName: employee.displayName,
    rosterOrder: employee.rosterOrder,
  }));
  const activeIds = new Set(active.map((employee) => employee.id));
  const shifts = listShiftsOverlapping(db, from, to)
    .filter((shift) => shift.employeeId == null || activeIds.has(shift.employeeId))
    .map((shift) => ({
      id: shift.id,
      date: shift.date,
      start: shift.start,
      end: shift.end,
      endDate: shift.endDate,
      category: shift.category,
      title: shift.title,
      location: shift.location,
      unrecognisedCode: shift.unrecognisedCode,
      templateId: shift.templateId,
      employeeId: shift.employeeId,
    }));
  return { employees, shifts };
}
```

- [ ] **Step 4: Запустить тест — должен пройти**

Run: `npx vitest run server/src/repo/team-schedule.test.ts`
Expected: PASS, 4 теста.

- [ ] **Step 5: Переключить роут**

В `server/src/http/app.ts` замени тело обработчика `/api/team/schedule` (всё, что после проверок `from`/`to`) на вызов новой функции. Проверки параметров остаются как были:

```ts
  app.get("/api/team/schedule", requireAuth(db, config.jwtSecret), (c) => {
    const from = c.req.query("from");
    const to = c.req.query("to");
    if (!from || !to) return c.json({ error: "from and to are required" }, 400);
    if (!dateStr.safeParse(from).success || !dateStr.safeParse(to).success) {
      return c.json({ error: "from and to must be valid YYYY-MM-DD dates" }, 400);
    }
    if (from > to) return c.json({ error: "from must not be after to" }, 400);
    if (dayNumber(to) - dayNumber(from) > 30) {
      return c.json({ error: "the range must span at most 31 days" }, 400);
    }
    // Формой ответа заведует repo/team-schedule: тем же шейпером сервер строит
    // картинку недели для бота, и расходиться они не должны.
    return c.json(readTeamSchedule(db, from, to));
  });
```

Добавь импорт `import { readTeamSchedule } from "../repo/team-schedule";` и убери из файла импорты, которые после этого стали неиспользуемыми (`listActiveInRosterOrder` и `listShiftsOverlapping` — только если их больше нигде в `app.ts` нет; проверь грепом).

- [ ] **Step 6: Прогнать весь набор**

Run: `npm test && npm run typecheck`
Expected: PASS. Существующие тесты роута (`server/src/http/read.test.ts`, `server/src/http/app.test.ts`) должны остаться зелёными без правок — это и есть доказательство, что форма ответа не изменилась.

- [ ] **Step 7: Коммит**

```bash
git add server/src/repo/team-schedule.ts server/src/repo/team-schedule.test.ts server/src/http/app.ts
git commit -m "$(cat <<'EOF'
refactor(server): шейпер расписания команды переезжает из роута в repo

Роут не просто отдаёт строки — он выбрасывает смены архивных и прячет note.
Картинке недели нужна ровно та же выборка, а копия этой фильтрации разъехалась
бы с роутом при первой же правке: архивный человек появился бы на картинке и не
появился бы в мини-аппе.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Вёрстка картинки — чистая функция «модель → SVG»

Самая тестируемая часть: ни одной зависимости, вход — модель, выход — строка.

**Files:**
- Create: `server/src/render/week-svg.ts`
- Create: `server/src/render/week-svg.test.ts`

**Interfaces:**
- Consumes: `WeekModel`, `WeekLegendItem`, `ScheduleEntryLike`, `splitDisplayName`, `categoryPalette`, `weekdayShort`, `isWeekend` — всё из `@planer/shared` (Tasks 1-3).
- Produces:
  ```ts
  export interface WeekSvgInput {
    model: WeekModel<ScheduleEntryLike>;
    legend: readonly WeekLegendItem[];
    /** Заголовок внутри картинки, напр. «Команда · 3–9 августа». */
    weekLabel: string;
    /** Сегодня по TEAM_TZ; если день попал в неделю, его колонка обводится. */
    today: string;
  }
  export function renderWeekSvg(input: WeekSvgInput): string;
  export function escapeXml(value: string): string;
  export const WEEK_SVG_WIDTH: number; // 1200
  ```

- [ ] **Step 1: Написать падающий тест**

Создай `server/src/render/week-svg.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildWeekLegend, buildWeekModel, type ScheduleEntryLike, type SchedulePresetLike } from "@planer/shared";
import { escapeXml, renderWeekSvg } from "./week-svg";

const MONDAY = "2026-08-03";

const PRESETS: SchedulePresetLike[] = [
  { id: 1, name: "День", accent: "blue", sortOrder: 1 },
  { id: 2, name: "Ночь", accent: "indigo", sortOrder: 2 },
];

function entry(over: Partial<ScheduleEntryLike> & { date: string }): ScheduleEntryLike {
  return {
    employeeId: 1, endDate: null, start: "08:00", end: "20:00",
    category: "shift", title: null, templateId: 1, unrecognisedCode: null,
    ...over,
  };
}

function svgFor(
  employees: { id: number; displayName: string; rosterOrder: number | null }[],
  shifts: ScheduleEntryLike[],
  today = "2026-08-05",
): string {
  const model = buildWeekModel(MONDAY, { employees, shifts }, PRESETS);
  return renderWeekSvg({ model, legend: buildWeekLegend(model), weekLabel: "Команда · 3–9 августа", today });
}

const TEAM = [
  { id: 1, displayName: "Иванов Иван", rosterOrder: 0 },
  { id: 2, displayName: "Петров Пётр", rosterOrder: 1 },
];

describe("renderWeekSvg", () => {
  it("возвращает корректный SVG заданной ширины", () => {
    const svg = svgFor(TEAM, []);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
    expect(svg).toContain('width="1200"');
  });

  it("пишет заголовок и все семь дней", () => {
    const svg = svgFor(TEAM, []);
    expect(svg).toContain("Команда · 3–9 августа");
    for (const day of ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]) {
      expect(svg, day).toContain(`>${day}<`);
    }
  });

  it("рисует по строке на человека", () => {
    const svg = svgFor(TEAM, []);
    expect(svg).toContain("Иванов");
    expect(svg).toContain("Петров");
  });

  it("заливает клетку цветом пресета и подписывает его буквой", () => {
    const svg = svgFor(TEAM, [entry({ date: "2026-08-05" })]);
    expect(svg).toContain('fill="#EAF0F0"'); // blue-слот палитры смен
    expect(svg).toContain(">Д<");
  });

  it("показывает +N, когда в клетке больше одной записи", () => {
    const svg = svgFor(TEAM, [
      entry({ date: "2026-08-03" }),
      entry({ date: "2026-08-03", templateId: 2, start: "20:00", end: "08:00" }),
    ]);
    expect(svg).toContain(">+1<");
  });

  it("обрезает длинную фамилию, а не выпускает её за колонку", () => {
    const длинный = [{ id: 1, displayName: "Мегадлиннофамильев Иван", rosterOrder: 0 }];
    const svg = svgFor(длинный, []);
    expect(svg).not.toContain("Мегадлиннофамильев");
    expect(svg).toContain("…");
  });

  it("обводит сегодняшнюю колонку и только когда сегодня внутри недели", () => {
    expect(svgFor(TEAM, [], "2026-08-05")).toContain('stroke="#2F80ED"');
    expect(svgFor(TEAM, [], "2026-09-01")).not.toContain('stroke="#2F80ED"');
  });

  it("пустая неделя рисует сетку и говорит, что записей нет", () => {
    const svg = svgFor(TEAM, []);
    expect(svg).toContain("Иванов");
    expect(svg).toContain("На этой неделе записей нет");
    expect(svg).not.toContain("Что значат буквы");
  });

  it("непустая неделя объясняет буквы", () => {
    const svg = svgFor(TEAM, [entry({ date: "2026-08-05" })]);
    expect(svg).toContain("Что значат буквы");
    expect(svg).toContain("День");
  });

  it("экранирует спецсимволы в именах — иначе одна фамилия ломает документ", () => {
    const опасный = [{ id: 1, displayName: "Иванов&Ко <b>", rosterOrder: 0 }];
    const svg = svgFor(опасный, []);
    expect(svg).toContain("Иванов&amp;Ко");
    expect(svg).not.toContain("Иванов&Ко");
  });

  it("escapeXml закрывает все пять спецсимволов", () => {
    expect(escapeXml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&apos;");
  });
});
```

- [ ] **Step 2: Запустить и убедиться, что падает**

Run: `npx vitest run server/src/render/week-svg.test.ts`
Expected: FAIL — `Failed to resolve import "./week-svg"`.

- [ ] **Step 3: Написать рендер**

Создай `server/src/render/week-svg.ts`:

```ts
import {
  categoryPalette,
  isWeekend,
  splitDisplayName,
  weekdayShort,
  type ScheduleEntryLike,
  type WeekLegendItem,
  type WeekModel,
} from "@planer/shared";

/**
 * Сетка «команда × неделя» в виде SVG — то, что бот присылает по /week.
 *
 * Чистая функция: на входе готовая модель, на выходе строка. Ни файловой
 * системы, ни шрифтов, ни растеризации — всё это дальше, в rasterize.ts. Так
 * вся вёрстка проверяется обычными тестами, без единого бинарника.
 *
 * Тема одна, светлая: у PNG нет темы, а светлый вариант читается и в тёмном
 * чате.
 */

export const WEEK_SVG_WIDTH = 1200;

const PAD = 16;
const TITLE_H = 44;
const NAME_COL = 244;
const DAY_COL = 132;
const HEADER_H = 64;
const ROW_H = 56;
const LEGEND_TITLE_H = 32;
const LEGEND_ROW_H = 40;
const MAX_SURNAME_CHARS = 16;
const MAX_GIVEN_CHARS = 12;
const MAX_LEGEND_CHARS = 40;

const INK = {
  canvas: "#FFFFFF",
  grid: "#D9DEE6",
  header: "#F2F5F9",
  weekend: "#E9EEF5",
  today: "#2F80ED",
  text: "#17202A",
  muted: "#6B7280",
} as const;

export interface WeekSvgInput {
  model: WeekModel<ScheduleEntryLike>;
  legend: readonly WeekLegendItem[];
  /** Заголовок внутри картинки, напр. «Команда · 3–9 августа». */
  weekLabel: string;
  /** Сегодня по TEAM_TZ; если день попал в неделю, его колонка обводится. */
  today: string;
}

/**
 * Экранирование обязательно: одна фамилия с амперсандом иначе делает документ
 * невалидным, и картинка не отрисуется ни для кого.
 */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** В SVG нет `text-overflow`, поэтому режем по символам сами. */
function clip(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

export function renderWeekSvg({ model, legend, weekLabel, today }: WeekSvgInput): string {
  const gridTop = PAD + TITLE_H;
  const bodyTop = gridTop + HEADER_H;
  const bodyHeight = model.rows.length * ROW_H;
  const legendBlock = LEGEND_TITLE_H
    + (legend.length > 0 ? Math.ceil(legend.length / 2) * LEGEND_ROW_H : LEGEND_ROW_H);
  const height = bodyTop + bodyHeight + legendBlock + PAD;
  const dayX = (index: number) => PAD + NAME_COL + index * DAY_COL;

  const out: string[] = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WEEK_SVG_WIDTH}" height="${height}"`
      + ` viewBox="0 0 ${WEEK_SVG_WIDTH} ${height}" font-family="DejaVu Sans">`,
  );
  out.push(`<rect width="${WEEK_SVG_WIDTH}" height="${height}" fill="${INK.canvas}"/>`);

  // Заголовок внутри картинки, а не только в подписи сообщения: пересланное
  // фото подпись теряет, и без него неясно, какая это неделя.
  out.push(
    `<text x="${PAD}" y="${PAD + 30}" font-size="26" font-weight="bold" fill="${INK.text}">`
      + `${escapeXml(weekLabel)}</text>`,
  );

  // Шапка и вертикальные заливки выходных — до строк, чтобы клетки легли поверх.
  out.push(`<rect x="${PAD}" y="${gridTop}" width="${WEEK_SVG_WIDTH - 2 * PAD}" height="${HEADER_H}" fill="${INK.header}"/>`);
  model.days.forEach((day, index) => {
    const x = dayX(index);
    if (isWeekend(day)) {
      out.push(`<rect x="${x}" y="${gridTop}" width="${DAY_COL}" height="${HEADER_H + bodyHeight}" fill="${INK.weekend}"/>`);
    }
    const centre = x + DAY_COL / 2;
    out.push(
      `<text x="${centre}" y="${gridTop + 26}" font-size="20" font-weight="bold"`
        + ` text-anchor="middle" fill="${INK.text}">${weekdayShort(day)}</text>`,
    );
    out.push(
      `<text x="${centre}" y="${gridTop + 50}" font-size="18" text-anchor="middle"`
        + ` fill="${INK.muted}">${Number(day.slice(8, 10))}</text>`,
    );
  });

  model.rows.forEach((row, rowIndex) => {
    const y = bodyTop + rowIndex * ROW_H;
    const name = splitDisplayName(row.displayName);
    out.push(
      `<text x="${PAD + 8}" y="${y + 34}" font-size="19" font-weight="bold" fill="${INK.text}">`
        + `${escapeXml(clip(name.surname, MAX_SURNAME_CHARS))}</text>`,
    );
    if (name.rest) {
      out.push(
        `<text x="${PAD + NAME_COL - 8}" y="${y + 34}" font-size="16" text-anchor="end"`
          + ` fill="${INK.muted}">${escapeXml(clip(name.rest, MAX_GIVEN_CHARS))}</text>`,
      );
    }
    row.cells.forEach((cell, dayIndex) => {
      const entry = cell.primary;
      if (!entry) return;
      const x = dayX(dayIndex);
      const palette = entry.palette ?? categoryPalette(entry.shift.category, false);
      out.push(
        `<rect x="${x + 4}" y="${y + 4}" width="${DAY_COL - 8}" height="${ROW_H - 8}" rx="8" fill="${palette.bg}"/>`,
      );
      out.push(
        `<text x="${x + DAY_COL / 2}" y="${y + ROW_H / 2 + 8}" font-size="22" font-weight="bold"`
          + ` text-anchor="middle" fill="${palette.fg}">${escapeXml(entry.palette?.code ?? "•")}</text>`,
      );
      if (cell.extraCount > 0) {
        out.push(
          `<text x="${x + DAY_COL - 12}" y="${y + 22}" font-size="14" text-anchor="end"`
            + ` fill="${palette.fg}">+${cell.extraCount}</text>`,
        );
      }
    });
    out.push(
      `<line x1="${PAD}" y1="${y + ROW_H}" x2="${WEEK_SVG_WIDTH - PAD}" y2="${y + ROW_H}"`
        + ` stroke="${INK.grid}" stroke-width="1"/>`,
    );
  });

  // Обводка сегодняшней колонки — поверх всего, иначе её съедают заливки клеток.
  const todayIndex = model.days.indexOf(today);
  if (todayIndex >= 0) {
    out.push(
      `<rect x="${dayX(todayIndex)}" y="${gridTop}" width="${DAY_COL}" height="${HEADER_H + bodyHeight}"`
        + ` fill="none" rx="6" stroke="${INK.today}" stroke-width="3"/>`,
    );
  }

  const legendTop = bodyTop + bodyHeight + LEGEND_TITLE_H;
  if (legend.length === 0) {
    out.push(
      `<text x="${PAD}" y="${legendTop + 8}" font-size="18" fill="${INK.muted}">`
        + `На этой неделе записей нет</text>`,
    );
  } else {
    out.push(
      `<text x="${PAD}" y="${bodyTop + bodyHeight + 26}" font-size="16" font-weight="bold"`
        + ` fill="${INK.muted}">Что значат буквы</text>`,
    );
    const columnWidth = (WEEK_SVG_WIDTH - 2 * PAD) / 2;
    legend.forEach((item, index) => {
      const x = PAD + (index % 2) * columnWidth;
      const y = legendTop + Math.floor(index / 2) * LEGEND_ROW_H;
      const palette = item.palette ?? categoryPalette(item.category ?? "shift", false);
      out.push(`<rect x="${x}" y="${y}" width="34" height="28" rx="6" fill="${palette.bg}"/>`);
      out.push(
        `<text x="${x + 17}" y="${y + 20}" font-size="16" font-weight="bold" text-anchor="middle"`
          + ` fill="${palette.fg}">${escapeXml(item.code)}</text>`,
      );
      out.push(
        `<text x="${x + 44}" y="${y + 20}" font-size="17" fill="${INK.text}">`
          + `${escapeXml(clip(item.label, MAX_LEGEND_CHARS))}</text>`,
      );
    });
  }

  out.push("</svg>");
  return out.join("");
}
```

- [ ] **Step 4: Запустить тест — должен пройти**

Run: `npx vitest run server/src/render/week-svg.test.ts`
Expected: PASS, 11 тестов.

- [ ] **Step 5: Прогнать весь набор и коммит**

Run: `npm test && npm run typecheck`
Expected: PASS.

```bash
git add server/src/render/week-svg.ts server/src/render/week-svg.test.ts
git commit -m "$(cat <<'EOF'
feat(week): вёрстка картинки недели — чистая функция «модель → SVG»

Ни файловой системы, ни шрифтов, ни растеризации: на входе модель, на выходе
строка. Вся вёрстка проверяется обычными тестами, без единого бинарника.

Имена и подписи экранируются: одна фамилия с амперсандом иначе делает документ
невалидным, и картинка не отрисовалась бы ни для кого.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Растеризация SVG → PNG

**Files:**
- Create: `server/src/render/rasterize.ts`
- Create: `server/src/render/rasterize.test.ts`
- Create: `server/assets/fonts/DejaVuSans.ttf`, `server/assets/fonts/DejaVuSans-Bold.ttf`, `server/assets/fonts/LICENSE-DejaVu.txt`
- Modify: `server/package.json`

**Interfaces:**
- Consumes: `WEEK_SVG_WIDTH` (Task 5).
- Produces:
  ```ts
  export function svgToPng(svg: string, width?: number): Buffer;
  ```

- [ ] **Step 1: Поставить зависимость**

```bash
npm install --workspace @planer/server @resvg/resvg-js@^2.6.2
```

Проверь, что в `package-lock.json` появились опциональные бинарники и для `darwin-arm64` (машина Антона), и для `linux-x64-gnu` (CI на ubuntu):

```bash
grep -c "resvg-js-darwin-arm64\|resvg-js-linux-x64-gnu" package-lock.json
```

Expected: число ≥ 2. Если linux-бинарника нет, `npm ci` на CI упадёт — доставь его явно:
`npm install --workspace @planer/server --save-optional @resvg/resvg-js-linux-x64-gnu@2.6.2`.

- [ ] **Step 2: Положить шрифт в репозиторий**

Системными шрифтами пользоваться нельзя: картинка стала бы зависеть от того, что установлено на машине, а на ubuntu-CI кириллица могла бы просто не отрисоваться — текст исчез бы молча.

```bash
mkdir -p server/assets/fonts
cd /tmp
curl -L -o dejavu.zip https://github.com/dejavu-fonts/dejavu-fonts/releases/download/version_2_37/dejavu-fonts-ttf-2.37.zip
unzip -o dejavu.zip
cp dejavu-fonts-ttf-2.37/ttf/DejaVuSans.ttf dejavu-fonts-ttf-2.37/ttf/DejaVuSans-Bold.ttf \
   /Users/user/planer-bot/server/assets/fonts/
cp dejavu-fonts-ttf-2.37/LICENSE /Users/user/planer-bot/server/assets/fonts/LICENSE-DejaVu.txt
cd /Users/user/planer-bot
ls -la server/assets/fonts/
```

Expected: два `.ttf` примерно по 700 КБ и файл лицензии. Репозиторий публичный — лицензия обязана лежать рядом со шрифтом.

Убедись, что `.gitignore` не отбрасывает `*.ttf`:

```bash
git check-ignore -v server/assets/fonts/DejaVuSans.ttf || echo "не игнорируется — хорошо"
```

- [ ] **Step 3: Написать падающий тест**

Создай `server/src/render/rasterize.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { svgToPng } from "./rasterize";

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200" viewBox="0 0 400 200" font-family="DejaVu Sans">`
  + `<rect width="400" height="200" fill="#FFFFFF"/>`
  + `<text x="20" y="60" font-size="24" fill="#17202A">Иванов Иван</text>`
  + `</svg>`;

describe("svgToPng", () => {
  it("отдаёт настоящий PNG заданной ширины", () => {
    const png = svgToPng(SVG, 800);
    // PNG-сигнатура: 89 50 4E 47 0D 0A 1A 0A
    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    // Ширина лежит в IHDR, big-endian, начиная с 16-го байта.
    expect(png.readUInt32BE(16)).toBe(800);
    expect(png.length).toBeGreaterThan(1000);
  });

  it("рисует кириллицу из приложенного шрифта, а не из системного", () => {
    // Если шрифт не подхватился, resvg молча пропускает текст: PNG остаётся
    // почти пустым и жмётся до крохотного размера. Сравниваем с холстом без
    // текста — с буквами файл обязан быть заметно тяжелее.
    const пустой = svgToPng(SVG.replace(/<text[\s\S]*?<\/text>/, ""), 800);
    expect(svgToPng(SVG, 800).length).toBeGreaterThan(пустой.length + 500);
  });
});
```

- [ ] **Step 4: Запустить и убедиться, что падает**

Run: `npx vitest run server/src/render/rasterize.test.ts`
Expected: FAIL — `Failed to resolve import "./rasterize"`.

- [ ] **Step 5: Написать адаптер**

Создай `server/src/render/rasterize.ts`:

```ts
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import { WEEK_SVG_WIDTH } from "./week-svg";

/**
 * SVG → PNG. Единственное место в проекте, которое знает про растеризатор.
 *
 * Шрифт берётся из репозитория, а системные намеренно выключены
 * (`loadSystemFonts: false`): иначе картинка зависела бы от того, что
 * установлено на конкретной машине, а на ubuntu-CI кириллица могла бы не
 * отрисоваться вовсе — текст исчез бы, и никто бы этого не заметил.
 */

// Этот файл лежит в server/src/render/, значит assets — двумя уровнями выше.
const FONTS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../assets/fonts");
const FONT_FILES = ["DejaVuSans.ttf", "DejaVuSans-Bold.ttf"].map((name) => resolve(FONTS_DIR, name));

export function svgToPng(svg: string, width: number = WEEK_SVG_WIDTH): Buffer {
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: width },
    font: {
      fontFiles: FONT_FILES,
      loadSystemFonts: false,
      defaultFontFamily: "DejaVu Sans",
    },
  });
  return Buffer.from(resvg.render().asPng());
}
```

- [ ] **Step 6: Запустить тест — должен пройти**

Run: `npx vitest run server/src/render/rasterize.test.ts`
Expected: PASS, 2 теста.

Если падает на разрешении шрифта — проверь путь: `node -e "console.log(require('fs').existsSync('server/assets/fonts/DejaVuSans.ttf'))"` должен напечатать `true`.

- [ ] **Step 7: Прогнать весь набор и коммит**

Run: `npm test && npm run typecheck`
Expected: PASS.

```bash
git add server/package.json package-lock.json server/src/render/rasterize.ts server/src/render/rasterize.test.ts server/assets/fonts
git commit -m "$(cat <<'EOF'
feat(week): растеризация SVG в PNG через resvg

Шрифт лежит в репозитории, системные выключены: иначе картинка зависела бы от
того, что установлено на машине, а на ubuntu-CI кириллица могла бы не
отрисоваться вовсе — текст исчез бы молча.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Сборка картинки недели

**Files:**
- Create: `server/src/bot/week-image.ts`
- Create: `server/src/bot/week-image.test.ts`

**Interfaces:**
- Consumes: `readTeamSchedule` (Task 4), `renderWeekSvg` (Task 5), `svgToPng` (Task 6), `buildWeekModel`/`buildWeekLegend`/`addDaysIso`/`formatWeekRangeLabelIso` (Tasks 1, 3), `listActiveTemplates` (`server/src/repo/templates.ts`).
- Produces:
  ```ts
  export type WeekImage =
    | { kind: "photo"; png: Buffer; caption: string }
    | { kind: "text"; text: string };
  export function buildWeekImage(db: Db, mondayIso: string, today: string): WeekImage;
  ```

- [ ] **Step 1: Написать падающий тест**

Создай `server/src/bot/week-image.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { makeTestDb } from "../db/testdb";
import { createEmployee, archiveEmployee } from "../repo/employees";
import { createShift } from "../repo/shifts";
import { buildWeekImage } from "./week-image";

const MONDAY = "2026-08-03";
const TODAY = "2026-08-06";

describe("buildWeekImage", () => {
  it("отдаёт PNG с подписью недели", () => {
    const db = makeTestDb();
    const ivanov = createEmployee(db, { displayName: "Иванов Иван" });
    createShift(db, { employeeId: ivanov.id, date: "2026-08-05", start: "08:00", end: "20:00", category: "shift" });

    const result = buildWeekImage(db, MONDAY, TODAY);

    expect(result.kind).toBe("photo");
    if (result.kind !== "photo") return;
    expect(result.png.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    expect(result.caption).toContain("Команда");
    expect(result.caption).toContain("август");
  });

  it("пустой ростер отвечает словами, а не пустой сеткой", () => {
    const db = makeTestDb();
    const result = buildWeekImage(db, MONDAY, TODAY);
    expect(result).toEqual({ kind: "text", text: "В расписании пока никого." });
  });

  it("каждый человек добавляет картинке ровно одну строку высоты", () => {
    // Ширина картинки равна ширине SVG, значит масштаб единица и высота PNG —
    // это высота вёрстки байт в байт. Высота лежит в IHDR с 20-го байта.
    const onePerson = makeTestDb();
    createEmployee(onePerson, { displayName: "Иванов Иван" });
    const twoPeople = makeTestDb();
    createEmployee(twoPeople, { displayName: "Иванов Иван" });
    createEmployee(twoPeople, { displayName: "Петров Пётр" });

    const a = buildWeekImage(onePerson, MONDAY, TODAY);
    const b = buildWeekImage(twoPeople, MONDAY, TODAY);

    expect(a.kind).toBe("photo");
    expect(b.kind).toBe("photo");
    if (a.kind !== "photo" || b.kind !== "photo") return;
    // ROW_H из week-svg.ts. Человек без записей всё равно получает свою строку —
    // пустая строка это факт «на этой неделе он не работает», а не отсутствие.
    expect(b.png.readUInt32BE(20) - a.png.readUInt32BE(20)).toBe(56);
  });

  it("подпись называет ту неделю, которую нарисовал", () => {
    const db = makeTestDb();
    createEmployee(db, { displayName: "Иванов Иван" });

    // Неделя 27 июля – 2 августа: подпись обязана перешагнуть границу месяца.
    const result = buildWeekImage(db, "2026-07-27", TODAY);

    expect(result.kind).toBe("photo");
    if (result.kind !== "photo") return;
    expect(result.caption).toContain("июля");
    expect(result.caption).toContain("августа");
  });

  it("смена архивного человека не оставляет на картинке ни следа", () => {
    // Две базы, отличающиеся ровно призраком: в первой архивный Петров со
    // сменой, во второй его нет вовсе. Картинка обязана выйти побайтово той же —
    // это и значит «не попал»: ни своей клеткой, ни строкой «Не назначено».
    const withGhost = makeTestDb();
    createEmployee(withGhost, { displayName: "Иванов Иван" });
    const departed = createEmployee(withGhost, { displayName: "Петров Пётр" });
    createShift(withGhost, { employeeId: departed.id, date: "2026-08-05", start: "08:00", end: "20:00", category: "shift" });
    // Дата архива ПОСЛЕ смены: смена остаётся за архивным, строки у него уже нет.
    archiveEmployee(withGhost, departed.id, "2026-08-06");

    const clean = makeTestDb();
    createEmployee(clean, { displayName: "Иванов Иван" });

    const a = buildWeekImage(withGhost, MONDAY, TODAY);
    const b = buildWeekImage(clean, MONDAY, TODAY);

    expect(a.kind).toBe("photo");
    expect(b.kind).toBe("photo");
    if (a.kind !== "photo" || b.kind !== "photo") return;
    expect(a.png.equals(b.png)).toBe(true);
  });
});
```

- [ ] **Step 2: Запустить и убедиться, что падает**

Run: `npx vitest run server/src/bot/week-image.test.ts`
Expected: FAIL — `Failed to resolve import "./week-image"`.

- [ ] **Step 3: Написать сборку**

Создай `server/src/bot/week-image.ts`:

```ts
import { addDaysIso, buildWeekLegend, buildWeekModel, formatWeekRangeLabelIso } from "@planer/shared";
import type { Db } from "../db/client";
import { readTeamSchedule } from "../repo/team-schedule";
import { listActiveTemplates } from "../repo/templates";
import { renderWeekSvg } from "../render/week-svg";
import { svgToPng } from "../render/rasterize";

/**
 * Картинка недели для бота: расписание → модель → SVG → PNG.
 *
 * Текстовый вариант — не запасной рендер, а честный ответ на случай, когда
 * рисовать нечего: сетка из нуля строк это не картинка, а недоразумение.
 */
export type WeekImage =
  | { kind: "photo"; png: Buffer; caption: string }
  | { kind: "text"; text: string };

export function buildWeekImage(db: Db, mondayIso: string, today: string): WeekImage {
  const sunday = addDaysIso(mondayIso, 6);
  const schedule = readTeamSchedule(db, mondayIso, sunday);
  if (schedule.employees.length === 0) return { kind: "text", text: "В расписании пока никого." };

  const model = buildWeekModel(mondayIso, schedule, listActiveTemplates(db));
  const label = `Команда · ${formatWeekRangeLabelIso(mondayIso, sunday)}`;
  const svg = renderWeekSvg({ model, legend: buildWeekLegend(model), weekLabel: label, today });
  return { kind: "photo", png: svgToPng(svg), caption: label };
}
```

Если typecheck ругается, что `ShiftTemplate` из `listActiveTemplates` не подходит под `SchedulePresetLike` — сверь поля: нужны `id`, `name`, `accent`, `sortOrder`. Все они в `server/src/db/schema.ts` есть; если тип `accent` там шире (`string`), сузь его в `SchedulePresetLike`-совместимый через существующий тип `TemplateAccent`.

- [ ] **Step 4: Запустить тест — должен пройти**

Run: `npx vitest run server/src/bot/week-image.test.ts`
Expected: PASS, 5 тестов.

- [ ] **Step 5: Прогнать весь набор и коммит**

Run: `npm test && npm run typecheck`
Expected: PASS.

```bash
git add server/src/bot/week-image.ts server/src/bot/week-image.test.ts
git commit -m "$(cat <<'EOF'
feat(week): сборка картинки недели из расписания

Расписание → модель → SVG → PNG, плюс подпись «Команда · 3–9 августа».
Пустой ростер отвечает словами: сетка из нуля строк это не картинка.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Команда `/week` и листание недель

**Files:**
- Modify: `server/src/bot/bot.ts:88-98` (меню команд), плюс новый блок обработчиков рядом с `/notifications`
- Create: `server/src/bot/week-command.test.ts`

**Interfaces:**
- Consumes: `buildWeekImage` (Task 7), `mondayOfIso`/`addDaysIso` (Task 1), `teamNow` (`server/src/util/team-time.ts`), `acting` (существующий гард внутри `createBot`).
- Produces: пользовательское поведение; экспортируемых имён не добавляет, кроме `WEEK_OFFSET_LIMIT` для теста.

- [ ] **Step 1: Написать падающий тест**

Создай `server/src/bot/week-command.test.ts`. За образец взяты хелперы из `server/src/bot/bot.test.ts` — сверься с ним и повтори форму `testBot`/`callbackUpdate` (они там локальные, не экспортируются):

```ts
import { describe, it, expect } from "vitest";
import type { Bot } from "grammy";
import { createBot } from "./bot";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount, archiveEmployee, getByTelegramId } from "../repo/employees";
import { createShift } from "../repo/shifts";
import type { Config } from "../config";
import type { Db } from "../db/client";

const config: Config = {
  botToken: "12345:tok", adminTelegramIds: [111], teamTz: "Europe/Moscow",
  databaseUrl: ":memory:", jwtSecret: "test-jwt-secret-that-is-long-enough-0123", publicUrl: "https://x.keenetic.pro",
};

function testBot(db: Db) {
  const bot = createBot({ db, config });
  bot.botInfo = {
    id: 42, is_bot: true, first_name: "Planer", username: "planer_bot",
    can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false,
  } as unknown as typeof bot.botInfo;
  const calls: { method: string; payload: any }[] = [];
  bot.api.config.use((_prev, method, payload) => {
    calls.push({ method, payload });
    return { ok: true, result: {} } as any;
  });
  return { bot, calls };
}

function commandUpdate(tgId: number, text: string) {
  return {
    update_id: 1,
    message: {
      message_id: 4, date: 1_712_803_046,
      chat: { id: tgId, first_name: "T", type: "private" as const },
      from: { id: tgId, is_bot: false, first_name: "T" },
      text,
      entities: [{ type: "bot_command" as const, offset: 0, length: text.length }],
    },
  } as unknown as Parameters<Bot["handleUpdate"]>[0];
}

function callbackUpdate(tgId: number, data: string) {
  return {
    update_id: 2,
    callback_query: {
      id: "cbq-1",
      from: { id: tgId, is_bot: false, first_name: "T" },
      message: {
        message_id: 5, date: 1_712_803_046,
        chat: { id: tgId, first_name: "T", type: "private" as const },
      },
      chat_instance: "x",
      data,
    },
  } as unknown as Parameters<Bot["handleUpdate"]>[0];
}

/** Заводит человека с привязанным Telegram и одной сменой на этой неделе. */
function linkedWorker(db: Db, tgId: number) {
  const employee = createEmployee(db, { displayName: "Иванов Иван", inviteToken: `tok-${tgId}` });
  linkTelegramAccount(db, `tok-${tgId}`, tgId, "ivanov", "Иван");
  const linked = getByTelegramId(db, tgId)!;
  createShift(db, { employeeId: linked.id, date: "2026-08-05", start: "08:00", end: "20:00", category: "shift" });
  return linked;
}

describe("/week", () => {
  it("незарегистрированному предлагает /start и фото не шлёт", async () => {
    const db = makeTestDb();
    const { bot, calls } = testBot(db);
    await bot.handleUpdate(commandUpdate(999, "/week"));
    expect(calls.some((call) => call.method === "sendPhoto")).toBe(false);
    expect(calls.find((call) => call.method === "sendMessage")?.payload.text).toContain("/start");
  });

  it("архивному отказывает", async () => {
    const db = makeTestDb();
    const worker = linkedWorker(db, 222);
    archiveEmployee(db, worker.id, "2026-08-06"); // третий аргумент обязателен
    const { bot, calls } = testBot(db);
    await bot.handleUpdate(commandUpdate(222, "/week"));
    expect(calls.some((call) => call.method === "sendPhoto")).toBe(false);
    expect(calls.find((call) => call.method === "sendMessage")?.payload.text).toContain("архиве");
  });

  it("работнику шлёт фото с кнопками листания", async () => {
    const db = makeTestDb();
    linkedWorker(db, 333);
    const { bot, calls } = testBot(db);
    await bot.handleUpdate(commandUpdate(333, "/week"));

    const photo = calls.find((call) => call.method === "sendPhoto");
    expect(photo).toBeDefined();
    const buttons = photo!.payload.reply_markup.inline_keyboard.flat();
    expect(buttons.map((b: { callback_data: string }) => b.callback_data)).toEqual(["week:-1", "week:1"]);
  });

  it("на текущей неделе кнопки «Текущая» нет, а на соседней есть", async () => {
    const db = makeTestDb();
    linkedWorker(db, 444);
    const { bot, calls } = testBot(db);

    await bot.handleUpdate(commandUpdate(444, "/week"));
    const firstPhoto = calls.find((call) => call.method === "sendPhoto")!;
    expect(JSON.stringify(firstPhoto.payload.reply_markup)).not.toContain("week:0");

    await bot.handleUpdate(callbackUpdate(444, "week:1"));
    const redrawn = calls.find((call) => call.method === "editMessageMedia")!;
    expect(JSON.stringify(redrawn.payload.reply_markup)).toContain("week:0");
  });

  it("листание перерисовывает фото, а не шлёт новое", async () => {
    const db = makeTestDb();
    linkedWorker(db, 555);
    const { bot, calls } = testBot(db);
    await bot.handleUpdate(callbackUpdate(555, "week:-2"));

    expect(calls.some((call) => call.method === "editMessageMedia")).toBe(true);
    expect(calls.some((call) => call.method === "sendPhoto")).toBe(false);
  });

  it("за границей диапазона отвечает тостом и картинку не трогает", async () => {
    const db = makeTestDb();
    linkedWorker(db, 666);
    const { bot, calls } = testBot(db);
    await bot.handleUpdate(callbackUpdate(666, "week:99"));

    expect(calls.some((call) => call.method === "editMessageMedia")).toBe(false);
    expect(calls.find((call) => call.method === "answerCallbackQuery")?.payload.text).toContain("Дальше не листаю");
  });
});
```

Сигнатура привязки (проверена по коду):

```ts
linkTelegramAccount(db, inviteToken: string, telegramUserId: number, tgUsername?: string, tgFirstName?: string): Employee | null
```

Токен приглашения кладётся при создании: `createEmployee(db, { displayName, inviteToken })`.

- [ ] **Step 2: Запустить и убедиться, что падает**

Run: `npx vitest run server/src/bot/week-command.test.ts`
Expected: FAIL — фото не отправляется, обработчиков ещё нет.

- [ ] **Step 3: Добавить команду в меню**

В `server/src/bot/bot.ts`, в `publishBotCommands`, добавь третий пункт и поправь комментарий над функцией (он утверждает, что команд две):

```ts
    await bot.api.setMyCommands([
      { command: "start", description: "Начать и открыть смены" },
      { command: "week", description: "График команды на неделю" },
      { command: "notifications", description: "Напоминания о сменах — включить или выключить" },
    ]);
```

- [ ] **Step 4: Написать обработчики**

В `server/src/bot/bot.ts` добавь импорты:

```ts
import { InputFile } from "grammy";
import { addDaysIso, mondayOfIso } from "@planer/shared";
import { buildWeekImage } from "./week-image";
```

(`InputFile` добавляется к существующему `import { Bot, InlineKeyboard } from "grammy";`.)

Рядом с `ADMIN_LINK_TTL_SEC` добавь константу и клавиатуру:

```ts
/**
 * Насколько далеко можно улистать от текущей недели. Полгода в обе стороны
 * покрывает всё, ради чего картинку вообще открывают; без ограничения кнопка
 * увела бы человека в 2043 год, где расписания нет и не будет.
 */
export const WEEK_OFFSET_LIMIT = 26;

/**
 * Кнопки под картинкой. Смещение в callback-данных абсолютное — недель от
 * ТЕКУЩЕЙ, а не от показанной: сообщение живёт в чате вечно, и кнопка, нажатая
 * через месяц, обязана отсчитывать от сегодняшнего дня, а не от того, каким он
 * был при отправке.
 */
function weekKeyboard(offset: number): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  if (offset > -WEEK_OFFSET_LIMIT) keyboard.text("‹ Пред.", `week:${offset - 1}`);
  // Возврат одним тапом: с 26-й недели дорога назад пешком это 26 нажатий.
  if (offset !== 0) keyboard.text("⌂ Текущая", "week:0");
  if (offset < WEEK_OFFSET_LIMIT) keyboard.text("След. ›", `week:${offset + 1}`);
  return keyboard;
}
```

Внутри `createBot`, после обработчика `/notifications`, добавь:

```ts
  /** Понедельник недели, отстоящей от текущей на `offset` недель, по времени команды. */
  function mondayForOffset(offset: number): { monday: string; today: string } {
    const today = teamNow(config.teamTz).date;
    return { monday: addDaysIso(mondayOfIso(today), offset * 7), today };
  }

  // /week — график команды картинкой. Видна всем в меню: это те же данные, что
  // /api/team/schedule уже отдаёт любому авторизованному работнику, просто на
  // другом носителе — картинку не надо открывать, она уже в чате.
  bot.command("week", async (ctx) => {
    const from = ctx.from;
    if (!from) return;
    const who = acting(from.id);
    if (!who.ok) {
      await ctx.reply(who.text === "Ты не в системе" ? "Сначала отправь /start." : `${who.text}.`);
      return;
    }
    const { monday, today } = mondayForOffset(0);
    let image;
    try {
      image = buildWeekImage(db, monday, today);
    } catch (err) {
      console.error("week: render failed:", safeErrorMessage(err));
      await ctx.reply("Не смог нарисовать график, открой мини-апп.");
      return;
    }
    if (image.kind === "text") {
      await ctx.reply(image.text);
      return;
    }
    await ctx.replyWithPhoto(new InputFile(image.png, "week.png"), {
      caption: image.caption,
      reply_markup: weekKeyboard(0),
    });
  });

  /**
   * Листание недель. В отличие от косметических edit'ов в этом файле, перерисовка
   * фото — и есть полезное действие, поэтому её провал сообщается человеку тостом,
   * а не только в лог.
   */
  bot.callbackQuery(/^week:(-?\d+)$/, async (ctx) => {
    const offset = Number(ctx.match[1]);
    const who = acting(ctx.from.id);
    if (!who.ok) {
      await ctx.answerCallbackQuery({ text: who.text });
      return;
    }
    // Кнопка за границей не рисуется, но сообщение живёт вечно — данные могут
    // прийти из чего угодно, поэтому предел проверяется и здесь.
    if (!Number.isInteger(offset) || Math.abs(offset) > WEEK_OFFSET_LIMIT) {
      await ctx.answerCallbackQuery({ text: "Дальше не листаю" });
      return;
    }
    const { monday, today } = mondayForOffset(offset);
    try {
      const image = buildWeekImage(db, monday, today);
      if (image.kind === "text") {
        await ctx.answerCallbackQuery({ text: image.text });
        return;
      }
      await ctx.editMessageMedia(
        { type: "photo", media: new InputFile(image.png, "week.png"), caption: image.caption },
        { reply_markup: weekKeyboard(offset) },
      );
      await ctx.answerCallbackQuery();
    } catch (err) {
      console.error("week: redraw failed:", safeErrorMessage(err));
      await ctx.answerCallbackQuery({ text: "Не получилось, попробуй ещё раз" });
    }
  });
```

- [ ] **Step 5: Запустить тест — должен пройти**

Run: `npx vitest run server/src/bot/week-command.test.ts`
Expected: PASS, 6 тестов.

Если тест «за границей диапазона» падает из-за того, что `answerCallbackQuery` зовётся дважды — убедись, что в успешной ветке он ровно один и стоит **после** `editMessageMedia`, а в ветках отказа `return` идёт сразу за ним.

- [ ] **Step 6: Прогнать весь набор**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Проверить руками на живом боте**

Слова «готово» без этого шага не произносить.

```bash
sudo launchctl kickstart -k system/com.planerbot.server
sleep 3
tail -20 ~/planer-bot.log
```

Expected: строка `bot @… started` и `planer-bot server listening on :8090` без ошибок.

Дальше в Telegram: `/week` → пришла картинка; кнопки листают; на соседней неделе появилась «⌂ Текущая». Приложи скриншот или опиши, что увидел.

- [ ] **Step 8: Коммит**

```bash
git add server/src/bot/bot.ts server/src/bot/week-command.test.ts
git commit -m "$(cat <<'EOF'
feat(week): команда /week шлёт график команды картинкой

Видна всем в меню Telegram. Под фото кнопки листания недель; смещение в
callback-данных абсолютное — сообщение живёт в чате вечно, и кнопка, нажатая
через месяц, отсчитывает от сегодняшнего дня, а не от дня отправки.

Провал перерисовки сообщается тостом, а не только в лог: в отличие от
косметических edit'ов рядом, здесь перерисовка и есть полезное действие.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9 (необязательная): убрать последнюю копию подписей категорий

**Находка, не входившая в спеку.** В `shared/src/category.ts` рядом с `categoryLabel` написано, что «мини-апп намеренно не зависит от `@planer/shared` в рантайме», и поэтому держит свою копию таблицы подписей, а `miniapp/src/category-labels.test.ts` сторожит их совпадение.

Это утверждение больше не соответствует коду: `@planer/shared` импортируется в рантайме в двенадцати файлах мини-аппа, включая сам `categories.tsx`. Значит копия — просто копия, а сторож охраняет расхождение, которого не может быть, если источник один.

Задача отдельная и необязательная: основной функциональности она не касается. **Спроси Антона перед выполнением** — удаление сторожевого теста это его решение, а не твоё.

**Files:**
- Modify: `miniapp/src/categories.tsx:9-21`
- Modify: `shared/src/category.ts:45-56` (комментарий)
- Delete: `miniapp/src/category-labels.test.ts`

- [ ] **Step 1: Заменить копию реэкспортом**

В `miniapp/src/categories.tsx` удали `CATEGORY_LABELS` и тело `categoryLabel`, добавив `categoryLabel` в импорт из `@planer/shared` и реэкспортировав его:

```ts
export { categoryLabel } from "@planer/shared";
```

- [ ] **Step 2: Поправить устаревший комментарий**

В `shared/src/category.ts` замени абзац про «мини-апп намеренно не зависит от shared в рантайме» на правду:

```ts
/**
 * Русская подпись категории — одна на всех.
 *
 * Её просит сервер (письмо об изменении графика называет вид записи словами) и
 * мини-апп (та же подпись в клетке). Человек должен прочитать в чате ровно то,
 * что увидит на экране, поэтому копий у неё быть не может.
 */
```

- [ ] **Step 3: Удалить ставший тавтологическим сторож**

```bash
git rm miniapp/src/category-labels.test.ts
```

- [ ] **Step 4: Прогнать весь набор**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Коммит**

```bash
git add miniapp/src/categories.tsx shared/src/category.ts
git commit -m "$(cat <<'EOF'
refactor(shared): подписи категорий больше не дублируются в мини-аппе

Комментарий рядом с categoryLabel утверждал, что мини-апп намеренно не зависит
от @planer/shared в рантайме. Это перестало быть правдой: shared импортируется
в двенадцати файлах мини-аппа, включая сам categories.tsx.

Копия удалена, сторож category-labels.test.ts вместе с ней: он охранял
расхождение, которого не бывает при одном источнике.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Проверка перед сдачей

- [ ] `npm test` — зелёный, вывод показан.
- [ ] `npm run typecheck` — зелёный, вывод показан.
- [ ] `npm run build --workspace @planer/miniapp` — собирается (переезды в shared не сломали бандл).
- [ ] `/week` проверен на живом боте: картинка пришла, кнопки листают, «⌂ Текущая» появляется и возвращает.
- [ ] Ни одного настоящего имени в новых фикстурах.
