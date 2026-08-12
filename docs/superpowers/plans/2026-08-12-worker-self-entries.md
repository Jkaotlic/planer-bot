# Работник пишет себе в график — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Работник ставит себе больничный и мероприятие из мини-аппа; запись падает в график сразу, админам уходит письмо, называющее смены, оставшиеся без человека.

**Architecture:** Правило «что работнику можно» — чистая функция в `shared`, её зовут и маршрут, и экран. Три новых маршрута под `requireAuth` отдельным роутером (`app.ts` уже резали на треке A, обратно наращивать его незачем). `employeeId` берётся из токена и в схему тела не входит вовсе. Письмо админам считает дни тем же кодом, что и письмо работнику.

**Tech Stack:** TypeScript, zod, Hono, drizzle + better-sqlite3, grammy, React + @telegram-apps/telegram-ui, vitest.

**Спека:** `docs/superpowers/specs/2026-08-12-worker-self-entries-design.md`

## Global Constraints

- **Слои:** `shared/`, `server/` — слой 1, **TDD обязателен** (сначала падающий тест). `miniapp/` — слой 2: логика тестами, вёрстка нет.
- **Ветка:** `feature/worker-self-entries`. Уже создана, спека в неё закоммичена.
- **Текст, который читает человек, — по-русски.** Английский только в именах кода.
- **Комментарии в `server/src/**` — по-английски**, и в коде, и в тестах; русские доменные термины в «ёлочках» внутри английской фразы. В `shared/` и в `miniapp/` комментарии русские — это действующая конвенция репозитория. Ревьюеры трижды ловили русские комментарии именно в тестовых файлах: самопроверка грепает реализацию и забывает тест рядом.
- **Идентификаторы только латиницей.** В репозитории нет ни одного кириллического имени переменной, а план, написанный по-русски, легко протаскивает `const заболевший` в фикстуру.
- **Настоящих ФИО быть не может** — репозиторий публичный. Имена в тестах: «Аня», «Игорь», «Марк», «Иванов Иван». Сторож: `server/src/db/no-real-names.test.ts`.
- **Дата — командная:** `teamNow(config.teamTz)`, никогда `new Date()`.
- **Гейт после каждой задачи:**
  ```bash
  npm test
  npm run typecheck
  npm run lint
  ```
  Ничего не готово без прогнанной команды с показанным выводом.
- **Коммиты по-русски**, в стиле истории: `feat(...)`, `refactor(...)`, `test(...)`, `docs(...)`.

## Структура файлов

| Файл | Ответственность |
| --- | --- |
| `shared/src/self-entry.ts` (**создать**) | Правило «что работнику можно» — чистое, без базы и HTTP |
| `shared/src/self-entry.test.ts` (**создать**) | Проверки правила напрямую |
| `shared/src/category.ts` (**править**) | Три падежные таблицы: `offsite` → «Мероприятие» |
| `shared/src/audit.ts` (**править**) | Три новых типа события и их описатели |
| `miniapp/src/categories.tsx`, `admin/src/categories.tsx` (**править**) | Копии подписи |
| `admin/src/category-labels.test.ts` (**создать**) | Сторож копии консоли — в мини-аппе такой есть, в консоли нет |
| `server/src/util/message-lines.ts` (**править**) | `entryAuditPayload` переезжает сюда из `app.ts` |
| `server/src/schedule/day-summary.ts` (**править**) | Голос строки: работнику или админам |
| `server/src/schedule/self-entry-notice.ts` (**создать**) | Три текста письма админам |
| `server/src/http/routes/my-entries.ts` (**создать**) | Три маршрута работника |
| `miniapp/src/screens/SelfEntryScreen.tsx` (**создать**) | Оверлей с двумя формами |
| `server/src/bot/keyboard.ts` (**править**) | Две кнопки, ведущие в эти формы |

Порядок задач продиктован зависимостями: правило и типы журнала нужны маршрутам готовыми, а кнопки в боте ставятся последними — кнопка, ведущая в ненаписанный экран, хуже отсутствующей.

---

### Task 1: Правило «что работник может поставить себе сам»

**Files:**
- Create: `shared/src/self-entry.ts`, `shared/src/self-entry.test.ts`
- Modify: `shared/src/index.ts` (barrel-реэкспорт)

**Interfaces:**
- Consumes: `EntryCategory` и `entryCategorySchema` из `./category`; `dayNumber` из `./time`.
- Produces:
  - `export const SICK_BACKDATE_DAYS = 7`
  - `export const SELF_ENTRY_HORIZON_DAYS = 182`
  - `export function isSelfWritable(category: EntryCategory): boolean`
  - `export interface SelfEntryDraft { category: EntryCategory; date: string; endDate?: string | null }`
  - `export function selfEntryRefusal(draft: SelfEntryDraft, today: string): string | null`
  - `export function selfEntryEditRefusal(entry: { category: EntryCategory; date: string; endDate?: string | null }, today: string): string | null`
  - `export function eachDayIso(from: string, to: string): string[]` — **в `shared/src/week-dates.ts`**, рядом с `addDaysIso`. Проверено грепом: такой функции в репозитории нет, а письмо админам обязано пройти по каждому дню многодневного больничного. Тест: однодневный диапазон даёт один день; трёхдневный — три по порядку; перевёрнутый — пустой массив, а не бесконечный цикл.

- [ ] **Step 1: Написать падающий тест**

Создать `shared/src/self-entry.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { entryCategorySchema } from "./category";
import { addDaysIso } from "./week-dates";
import {
  isSelfWritable,
  selfEntryRefusal,
  selfEntryEditRefusal,
  SICK_BACKDATE_DAYS,
  SELF_ENTRY_HORIZON_DAYS,
} from "./self-entry";

const TODAY = "2026-08-12";

/** Сдвиг от сегодня в днях — чтобы фикстуры читались, а не считались глазами. */
function day(offset: number): string {
  return addDaysIso(TODAY, offset);
}

describe("что работник может поставить себе сам", () => {
  it("ровно две категории из семи — остальное ведёт админ", () => {
    const writable = entryCategorySchema.options.filter(isSelfWritable);
    expect(writable).toEqual(["sick_leave", "offsite"]);
  });

  it("смену себе поставить нельзя", () => {
    expect(selfEntryRefusal({ category: "shift", date: TODAY }, TODAY)).not.toBeNull();
  });

  it("больничный задним числом можно ровно на семь дней", () => {
    expect(selfEntryRefusal({ category: "sick_leave", date: day(-SICK_BACKDATE_DAYS) }, TODAY)).toBeNull();
    expect(selfEntryRefusal({ category: "sick_leave", date: day(-SICK_BACKDATE_DAYS - 1) }, TODAY)).not.toBeNull();
  });

  it("мероприятие задним числом нельзя вовсе — передавать нечего, предупреждать некого", () => {
    expect(selfEntryRefusal({ category: "offsite", date: day(-1) }, TODAY)).not.toBeNull();
    expect(selfEntryRefusal({ category: "offsite", date: TODAY }, TODAY)).toBeNull();
  });

  it("дальше горизонта не пускает — там графика нет", () => {
    expect(selfEntryRefusal({ category: "offsite", date: day(SELF_ENTRY_HORIZON_DAYS) }, TODAY)).toBeNull();
    expect(selfEntryRefusal({ category: "offsite", date: day(SELF_ENTRY_HORIZON_DAYS + 1) }, TODAY)).not.toBeNull();
  });

  it("запись длиннее горизонта не пускает", () => {
    const draft = { category: "sick_leave" as const, date: TODAY, endDate: day(SELF_ENTRY_HORIZON_DAYS + 1) };
    expect(selfEntryRefusal(draft, TODAY)).not.toBeNull();
  });

  it("перевёрнутый диапазон — не наша забота, его ловит entryRangeError", () => {
    // Здесь важно, что правило про ПРАВА не выдумывает себе второй проверки
    // согласованности: она уже есть и живёт в одном месте.
    expect(selfEntryRefusal({ category: "sick_leave", date: TODAY, endDate: day(-3) }, TODAY)).toBeNull();
  });
});

describe("что работник может ещё править", () => {
  it("кончившуюся вчера — уже нет, это отчётность", () => {
    expect(selfEntryEditRefusal({ category: "sick_leave", date: day(-3), endDate: day(-1) }, TODAY)).not.toBeNull();
  });

  it("кончающуюся сегодня — ещё да", () => {
    expect(selfEntryEditRefusal({ category: "sick_leave", date: day(-3), endDate: TODAY }, TODAY)).toBeNull();
  });

  it("идущий больничный продлевается: граница считается по концу, а не по началу", () => {
    expect(selfEntryEditRefusal({ category: "sick_leave", date: day(-2), endDate: day(1) }, TODAY)).toBeNull();
  });

  it("чужую категорию не правит — даже свою собственную смену", () => {
    expect(selfEntryEditRefusal({ category: "shift", date: day(5) }, TODAY)).not.toBeNull();
  });
});
```

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `npx vitest run shared/src/self-entry.test.ts`
Expected: FAIL — `Failed to resolve import "./self-entry"`.

- [ ] **Step 3: Реализация**

Создать `shared/src/self-entry.ts`:

```ts
import { entryCategorySchema, type EntryCategory } from "./category";
import { dayNumber } from "./time";

/**
 * Что работник может поставить себе сам.
 *
 * Множество — рантайм-значение, а не только объединение типов, по той же
 * причине, что `SWAPPABLE` и `AUDIT_TYPES`: тест на полноту может перебрать все
 * категории и проверить, что самозаписываемых ровно две, вместо сверки двух
 * списков, набранных руками в разных файлах.
 *
 * Больничный — потому что болезнь не согласовывают. Мероприятие — потому что
 * человек сам знает, куда он едет. Всё остальное — смены, дежурства, отпуска,
 * командировки — это график, и его ведёт админ.
 */
const SELF_WRITABLE: ReadonlySet<EntryCategory> = new Set(["sick_leave", "offsite"]);

export function isSelfWritable(category: EntryCategory): boolean {
  return SELF_WRITABLE.has(category);
}

/**
 * На сколько дней назад можно начать больничный.
 *
 * Граница между «сообщаю о факте, который уже случился» и «переписываю
 * историю». Заболел в пятницу вечером, отлежался, написал в понедельник — это
 * первое. Больничный на прошлый март — второе, и его ставит админ, у которого
 * есть контекст закрытого месяца и уже сданных отчётов.
 */
export const SICK_BACKDATE_DAYS = 7;

/**
 * Горизонт: и «как далеко вперёд», и «какой длины».
 *
 * 26 недель — то же число, что у листалки `/week` (`WEEK_OFFSET_LIMIT`), и по
 * той же причине: дальше графика не существует, и запись туда — это не план, а
 * промах по полю ввода.
 */
export const SELF_ENTRY_HORIZON_DAYS = 26 * 7;

export interface SelfEntryDraft {
  category: EntryCategory;
  date: string;
  endDate?: string | null;
}

/**
 * Может ли работник ЗАВЕСТИ такую запись. Возвращает причину отказа словами,
 * которые не стыдно показать человеку, или `null`, если можно.
 *
 * Проверок согласованности здесь нет намеренно — «конец раньше начала», «у
 * отсутствия не бывает времени» и прочее живут в `entry-schema.ts` и относятся
 * к самой записи, а не к тому, кто её пишет. Вторая копия этих правил здесь
 * разъехалась бы с первой.
 */
export function selfEntryRefusal(draft: SelfEntryDraft, today: string): string | null {
  if (!isSelfWritable(draft.category)) return "Такую запись ставит админ";

  const offset = dayNumber(draft.date) - dayNumber(today);
  const earliest = draft.category === "sick_leave" ? -SICK_BACKDATE_DAYS : 0;
  if (offset < earliest) {
    return draft.category === "sick_leave"
      ? `Больничный можно поставить не раньше чем за ${SICK_BACKDATE_DAYS} дней до сегодня — если нужно раньше, попроси админа`
      : "Мероприятие ставится на сегодня или вперёд";
  }
  if (offset > SELF_ENTRY_HORIZON_DAYS) return "Слишком далеко — дальше полугода графика ещё нет";

  const end = draft.endDate ?? draft.date;
  if (dayNumber(end) - dayNumber(draft.date) > SELF_ENTRY_HORIZON_DAYS) {
    return "Запись длиннее полугода — если это правда так, её поставит админ";
  }
  return null;
}

/**
 * Может ли работник ещё ПРАВИТЬ или снять эту запись.
 *
 * Граница по концу, а не по началу: больничный, начавшийся позавчера и идущий
 * до завтра, — это то, что продлевают, и запретить его правку значило бы
 * сломать единственный способ продления. А запись, которая уже кончилась, —
 * отчётность: она попала в баланс и в выгрузку, и трогать её должен тот, кто
 * видит последствия.
 *
 * Кто завёл запись — не спрашиваем. Если на человеке висит больничный, а он не
 * болеет, тот должен сниматься независимо от того, чьи руки его напечатали.
 */
export function selfEntryEditRefusal(
  entry: { category: EntryCategory; date: string; endDate?: string | null },
  today: string,
): string | null {
  if (!isSelfWritable(entry.category)) return "Такую запись правит админ";
  if ((entry.endDate ?? entry.date) < today) return "Запись уже кончилась — если что-то не так, напиши админу";
  return null;
}

// `entryCategorySchema` импортирован ради типа и ради того, чтобы тест на
// полноту мог перебрать все категории через `.options`.
export type { EntryCategory };
export { entryCategorySchema };
```

Если biome ругнётся на реэкспорт в конце — убрать его и импортировать `entryCategorySchema` в тесте напрямую из `./category`.

- [ ] **Step 4: Добавить в barrel**

В `shared/src/index.ts` дописать рядом с остальными строками:

```ts
export * from "./self-entry";
```

- [ ] **Step 5: Прогнать тест**

Run: `npx vitest run shared/src/self-entry.test.ts`
Expected: PASS, 11 тестов.

- [ ] **Step 6: Гейт**

Run: `npm test && npm run typecheck && npm run lint`
Expected: всё зелёное.

- [ ] **Step 7: Коммит**

```bash
git add shared/src/self-entry.ts shared/src/self-entry.test.ts shared/src/index.ts
git commit -m "feat(правила): что работник может поставить себе сам

Одна чистая функция, которую позовут оба — маршрут и экран. Экран, прячущий
то, что сервер разрешает, — наблюдаемый дефект, а не расхождение вкусов; про
isSwappable это в репозитории уже записано.

Больничный задним числом ровно на семь дней: это граница между «сообщаю о
факте» и «переписываю историю». Мероприятие назад нельзя вовсе — передавать
нечего, предупреждать некого.

Право на правку считается по КОНЦУ записи, а не по началу: иначе идущий
больничный нельзя было бы продлить, а продление — это и есть правка."
```

---

### Task 2: «Выездное мероприятие» становится «Мероприятием»

**Files:**
- Modify: `shared/src/category.ts` (три таблицы: `CATEGORY_LABELS`, `CATEGORY_ACCUSATIVE`, `CATEGORY_POSSESSIVE`)
- Modify: `miniapp/src/categories.tsx:21`, `admin/src/categories.tsx:17`
- Create: `admin/src/category-labels.test.ts`

**Interfaces:**
- Produces: `categoryLabel("offsite") === "Мероприятие"`, `categoryAccusative("offsite") === "мероприятие"`, `categoryPossessive("offsite") === "твоё мероприятие"`.

- [ ] **Step 1: Написать падающий сторож для консоли**

В мини-аппе сторож копии уже есть (`miniapp/src/category-labels.test.ts`), в консоли — **нет**, хотя копия точно такая же. Заводим его до правки, чтобы правка была им прикрыта.

Создать `admin/src/category-labels.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { categoryLabel as sharedLabel, entryCategorySchema } from "@planer/shared";
import { categoryLabel } from "./categories";

/**
 * Зеркало сторожа из мини-аппа. Подписи категорий лежат в трёх копиях сразу —
 * `@planer/shared`, `miniapp/src/categories.tsx` и эта, — и расходиться им
 * нельзя: сервер берёт слова из shared для письма об изменении графика, а
 * админ, открыв консоль, должен увидеть в клетке ровно то, что человеку
 * написали в чат.
 *
 * Копия в мини-аппе была прикрыта тестом с самого начала, эта — нет.
 * Обнаружилось при переименовании «Выездного мероприятия» в «Мероприятие»:
 * shared и мини-апп поменялись бы принудительно, а консоль тихо осталась бы со
 * старым словом.
 *
 * Категории перебираются из схемы, а не из списка руками: список разъехался бы
 * с реальностью ровно так же, как таблицы, которые он стережёт.
 */
describe("подписи категорий в консоли", () => {
  it("совпадают с shared", () => {
    for (const category of entryCategorySchema.options) {
      expect(categoryLabel(category), category).toBe(sharedLabel(category));
    }
  });
});
```

- [ ] **Step 2: Прогнать — сторож должен быть ЗЕЛЁНЫМ**

Run: `npx vitest run admin/src/category-labels.test.ts`
Expected: PASS. Копии сейчас согласованы; сторож фиксирует это состояние до правки. Если он красный уже сейчас — остановиться: значит копии УЖЕ разъехались, и это отдельная находка, которую надо показать владельцу, а не чинить заодно.

- [ ] **Step 3: Переименовать в `shared` — сторожа должны покраснеть**

В `shared/src/category.ts`:

```ts
const CATEGORY_LABELS: Record<EntryCategory, string> = {
  // …
  // «Мероприятие», а не «Выездное мероприятие»: выездное отличается заполненным
  // `location`, и это поле, а не категория. Категория, отличающаяся от соседней
  // только наличием строчки текста, — это поле.
  offsite: "Мероприятие",
  // …
};
```

и так же `offsite: "мероприятие"` в `CATEGORY_ACCUSATIVE`, `offsite: "твоё мероприятие"` в `CATEGORY_POSSESSIVE`.

Run: `npx vitest run admin/src/category-labels.test.ts miniapp/src/category-labels.test.ts`
Expected: **FAIL оба** — «Выездное мероприятие» против «Мероприятие». Это доказательство, что сторожа работают.

- [ ] **Step 4: Догнать обе копии**

`miniapp/src/categories.tsx:21` и `admin/src/categories.tsx:17` — `offsite: "Мероприятие"`.

Run: `npx vitest run admin/src/category-labels.test.ts miniapp/src/category-labels.test.ts`
Expected: PASS оба.

- [ ] **Step 5: Гейт**

Run: `npm test && npm run typecheck && npm run lint`
Expected: зелёное. Если где-то падает тест, ждавший строку «Выездное мероприятие», — это его правда, обновить ожидание.

- [ ] **Step 6: Коммит**

```bash
git add shared/src/category.ts miniapp/src/categories.tsx admin/src/categories.tsx admin/src/category-labels.test.ts
git commit -m "feat(категории): «Выездное мероприятие» становится «Мероприятием»

Выездное отличается заполненным «Местом», а не отдельной категорией: это не
два разных вида работы, а один — с адресом или без. Так работник, поставивший
себе совещание в офисе, перестанет читать в клетке слово «выездное».

Заодно заведён сторож копии подписей в КОНСОЛИ. В мини-аппе такой был с самого
начала, в консоли — нет, хотя копия точно такая же: shared и мини-апп
поменялись бы принудительно, а консоль тихо осталась бы со старым словом.
Сторож заведён ДО правки и покраснел на ней — иначе он не доказывал бы ничего."
```

---

### Task 3: Строка про день умеет говорить админам

**Files:**
- Modify: `server/src/schedule/day-summary.ts`
- Modify: `server/src/schedule/day-summary.test.ts`

**Interfaces:**
- Produces: `dayAfterLine(db, { employeeId, date, keepSilentForEntryId, voice })`, где `voice?: "worker" | "admins"` (по умолчанию `"worker"` — существующие вызовы не трогаются).

**Расхождение со спекой, зафиксированное здесь.** Спека писала, что параметр переключает только зачин строки. На деле у голосов расходится и состав списка: работнику названная запись показывается (она часть его дня), а админам — нет. Админ только что прочитал «Аня поставил(а) себе больничный 12–14 авг», и повтор «весь день · Больничный» в каждой строке — шум; ему нужно ровно то, что осталось ПОД угрозой. Значит: для `admins` названная запись исключается, и если больше ничего не осталось — строки нет вовсе. Спеку поправить в этом же заходе.

- [ ] **Step 1: Написать падающий тест**

Дописать в `server/src/schedule/day-summary.test.ts`:

```ts
describe("dayAfterLine for admins", () => {
  it("names what is left at risk, without addressing anyone", () => {
    const db = makeTestDb();
    const worker = person(db, "Аня");
    const shift = createShift(db, { employeeId: worker, date: "2026-08-12", start: "09:00", end: "18:00", category: "shift", title: "День" });
    const sick = createShift(db, { employeeId: worker, date: "2026-08-12", endDate: "2026-08-14", category: "sick_leave" });

    const line = dayAfterLine(db, { employeeId: worker, date: "2026-08-12", keepSilentForEntryId: sick.id, voice: "admins" });
    expect(line).toContain("09:00–18:00");
    expect(line).not.toContain("тебя");
    // Сам больничный админ уже прочитал строкой выше — повторять его здесь шум.
    expect(line).not.toContain("Больничный");
    expect(shift.id).toBeGreaterThan(0);
  });

  it("says nothing when the day holds only the entry we just named", () => {
    const db = makeTestDb();
    const worker = person(db, "Аня");
    const sick = createShift(db, { employeeId: worker, date: "2026-08-13", endDate: "2026-08-13", category: "sick_leave" });

    expect(dayAfterLine(db, { employeeId: worker, date: "2026-08-13", keepSilentForEntryId: sick.id, voice: "admins" })).toBeNull();
  });

  /** Сторож от разъезда двух голосов: письмо работнику обязано остаться прежним. */
  it("still addresses the worker when the voice is not given", () => {
    const db = makeTestDb();
    const worker = person(db, "Аня");
    createShift(db, { employeeId: worker, date: "2026-08-12", start: "09:00", end: "18:00", category: "shift", title: "День" });
    const other = createShift(db, { employeeId: worker, date: "2026-08-12", start: "11:00", end: "20:00", category: "shift", title: "Вечер" });

    const line = dayAfterLine(db, { employeeId: worker, date: "2026-08-12", keepSilentForEntryId: other.id });
    expect(line).toContain("у тебя");
    // Названная запись работнику показывается — она часть его дня.
    expect(line).toContain("11:00–20:00");
  });
});
```

Если в файле ещё нет хелпера `person(db, name)` — взять его форму из соседнего теста в том же файле; если и там нет, объявить локально:

```ts
function person(db: Db, displayName: string): number {
  return createEmployee(db, { displayName, inviteToken: `tok-${displayName}` }).id;
}
```

- [ ] **Step 2: Прогнать — падает**

Run: `npx vitest run server/src/schedule/day-summary.test.ts`
Expected: FAIL — `voice` в типе опций нет, TypeScript ругается ещё до прогона.

- [ ] **Step 3: Реализация**

В `server/src/schedule/day-summary.ts` расширить опции и разветвить только зачин и фильтр:

```ts
interface DayAfterOpts {
  employeeId: number;
  date: string;
  /**
   * The entry the letter already named. When it is the only thing left on that
   * day, this line would just repeat the sentence above it.
   */
  keepSilentForEntryId: number;
  /**
   * Who the line is addressed to. Default «worker» is the letter this function
   * was written for and must not change.
   *
   * «admins» differs in two ways, both for the same reason — the admin has just
   * read WHAT was recorded and needs to know what is now UNCOVERED: the named
   * entry is dropped from the list rather than repeated, and a day holding
   * nothing else produces no line at all. A multi-day sick leave would otherwise
   * spell out fourteen lines of «ничего».
   */
  voice?: "worker" | "admins";
}
```

и в теле:

```ts
  const all = listShiftsOverlapping(db, opts.date, opts.date).filter(
    (entry) => entry.employeeId === opts.employeeId,
  );
  const forAdmins = opts.voice === "admins";
  const mine = forAdmins ? all.filter((entry) => entry.id !== opts.keepSilentForEntryId) : all;

  if (forAdmins) {
    if (mine.length === 0) return null;
  } else {
    const onlyTheNamedOne = mine.length === 1 && mine[0]!.id === opts.keepSilentForEntryId;
    if (onlyTheNamedOne) return null;
    if (mine.length === 0) return `Теперь на ${dayLabel(opts.date)} у тебя ничего.`;
  }
```

а сборку хвоста (`parts`) оставить как есть, поменяв только префикс итоговой строки:

```ts
  const lead = forAdmins ? `На ${dayLabel(opts.date)} стоят: ` : `Теперь на ${dayLabel(opts.date)} у тебя: `;
  return `${lead}${parts.join(", ")}.`;
```

- [ ] **Step 4: Прогнать**

Run: `npx vitest run server/src/schedule/day-summary.test.ts`
Expected: PASS, включая три новых и все прежние.

- [ ] **Step 5: Поправить спеку**

В `docs/superpowers/specs/2026-08-12-worker-self-entries-design.md`, раздел «3. Письмо админам», заменить фразу про «параметр, переключающий зачин» на честную: голос меняет и зачин, и состав списка — названная запись админам не повторяется, а день, где больше ничего не осталось, строки не даёт.

- [ ] **Step 6: Гейт и коммит**

```bash
npm test && npm run typecheck && npm run lint
git add server/src/schedule/day-summary.ts server/src/schedule/day-summary.test.ts docs/superpowers/specs/2026-08-12-worker-self-entries-design.md
git commit -m "feat(уведомления): строка про день умеет говорить не только работнику

Тот же подсчёт дня, два адресата. Работнику — «Теперь на Ср 12 авг у тебя: …»,
как и было. Админам — «На Ср 12 авг стоят: …», без обращения и без повтора той
записи, о которой письмо: админу нужно ровно то, что осталось БЕЗ человека.

Два подсчёта разводить нельзя: они разъедутся, и два письма об одном дне
начнут говорить разное — этот дефект в репозитории уже чинился (d9f16bc).

Спека поправлена в том же заходе: она обещала, что параметр меняет только
зачин, а он меняет и состав списка."
```

---

### Task 4: Тексты письма админам

**Files:**
- Create: `server/src/schedule/self-entry-notice.ts`, `server/src/schedule/self-entry-notice.test.ts`

**Interfaces:**
- Consumes: `categoryAccusative` из `@planer/shared`; `dayLabel` из `../util/message-lines`.
- Produces:
  - `export interface SelfEntryLike { category: EntryCategory; date: string; endDate?: string | null; title?: string | null; start?: string | null; end?: string | null; location?: string | null }`
  - `export function selfEntryCreatedText(actorName: string, entry: SelfEntryLike, dayLines: string[]): string`
  - `export function selfEntryUpdatedText(actorName: string, before: SelfEntryLike, after: SelfEntryLike, dayLines: string[]): string`
  - `export function selfEntryDeletedText(actorName: string, entry: SelfEntryLike): string`

- [ ] **Step 1: Написать падающий тест**

Создать `server/src/schedule/self-entry-notice.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { selfEntryCreatedText, selfEntryUpdatedText, selfEntryDeletedText } from "./self-entry-notice";

const sick = { category: "sick_leave" as const, date: "2026-08-12", endDate: "2026-08-14" };
const event = { category: "offsite" as const, date: "2026-08-20", start: "14:00", end: "16:00", title: "Конференция" };

describe("what the admins read", () => {
  it("names the person, what they recorded and the span", () => {
    const text = selfEntryCreatedText("Аня", sick, []);
    expect(text).toContain("Аня");
    expect(text).toContain("больничный");
    expect(text).toContain("12 авг");
    expect(text).toContain("14 авг");
  });

  it("carries the day lines — that is what names the uncovered shift", () => {
    const text = selfEntryCreatedText("Аня", sick, ["На Ср 12 авг стоят: 09:00–18:00 · День."]);
    expect(text).toContain("09:00–18:00");
  });

  it("names an event by its own title, not by the category word", () => {
    expect(selfEntryCreatedText("Игорь", event, [])).toContain("Конференция");
  });

  /** «поставил(а)» — та же форма, что во всех письмах бота: в базе есть имя, но не пол. */
  it("uses the genderless verb form the rest of the bot uses", () => {
    expect(selfEntryCreatedText("Аня", sick, [])).toContain("(а)");
  });

  it("an edit says what it was and what it became", () => {
    const after = { ...sick, endDate: "2026-08-16" };
    const text = selfEntryUpdatedText("Аня", sick, after, []);
    expect(text).toContain("14 авг");
    expect(text).toContain("16 авг");
  });

  it("a removal does not pretend anything is still standing", () => {
    const text = selfEntryDeletedText("Аня", sick);
    expect(text).toContain("снял(а)");
    expect(text).not.toContain("стоят");
  });
});
```

- [ ] **Step 2: Прогнать — падает**

Run: `npx vitest run server/src/schedule/self-entry-notice.test.ts`
Expected: FAIL — модуля нет.

- [ ] **Step 3: Реализация**

Создать `server/src/schedule/self-entry-notice.ts`:

```ts
import { categoryAccusative, type EntryCategory } from "@planer/shared";
import { dayLabel } from "../util/message-lines";

export interface SelfEntryLike {
  category: EntryCategory;
  date: string;
  endDate?: string | null;
  title?: string | null;
  start?: string | null;
  end?: string | null;
  location?: string | null;
}

/** «больничный» / «мероприятие «Конференция»» — what the entry is called in a sentence. */
function subjectOf(entry: SelfEntryLike): string {
  const word = categoryAccusative(entry.category);
  // An event is named by the words the person typed. The category word alone
  // would make every event letter read the same, and the admin's first question
  // is «какое именно».
  return entry.title ? `${word} «${entry.title}»` : word;
}

/** «Ср 12 авг – Пт 14 авг · 14:00–16:00» — when it is, as precisely as the entry knows. */
function whenOf(entry: SelfEntryLike): string {
  const span = entry.endDate && entry.endDate !== entry.date
    ? `${dayLabel(entry.date)} – ${dayLabel(entry.endDate)}`
    : dayLabel(entry.date);
  const hours = entry.start && entry.end ? ` · ${entry.start}–${entry.end}` : "";
  const place = entry.location ? ` · ${entry.location}` : "";
  return `${span}${hours}${place}`;
}

/**
 * The letter admins get when somebody records their own absence or event.
 *
 * `dayLines` is the important half, not decoration: it is what names the shift
 * left with nobody on it. Until the handover feature exists (заход 3), this
 * letter is the ONLY thing that reports an uncovered shift at all.
 *
 * «поставил(а)» rather than a gendered verb — the same form the rest of this
 * bot uses, because the database holds a name and nothing to derive gender from.
 */
export function selfEntryCreatedText(actorName: string, entry: SelfEntryLike, dayLines: string[]): string {
  return [`${actorName} поставил(а) себе ${subjectOf(entry)}: ${whenOf(entry)}.`, ...dayLines].join("\n");
}

export function selfEntryUpdatedText(
  actorName: string,
  before: SelfEntryLike,
  after: SelfEntryLike,
  dayLines: string[],
): string {
  return [
    `${actorName} изменил(а) себе ${subjectOf(after)}: было ${whenOf(before)} → стало ${whenOf(after)}.`,
    ...dayLines,
  ].join("\n");
}

/** No day lines here on purpose: nothing was added, so nothing is newly at risk. */
export function selfEntryDeletedText(actorName: string, entry: SelfEntryLike): string {
  return `${actorName} снял(а) с себя ${subjectOf(entry)}: ${whenOf(entry)}.`;
}
```

- [ ] **Step 4: Прогнать**

Run: `npx vitest run server/src/schedule/self-entry-notice.test.ts`
Expected: PASS, 6 тестов.

- [ ] **Step 5: Гейт и коммит**

```bash
npm test && npm run typecheck && npm run lint
git add server/src/schedule/self-entry-notice.ts server/src/schedule/self-entry-notice.test.ts
git commit -m "feat(уведомления): что админы читают, когда работник записал себя сам

Три текста: завёл, поправил, снял. Мероприятие называется словами, которые
написал человек, — иначе все письма о мероприятиях читались бы одинаково, а
первый вопрос админа именно «какое».

Строки про день несёт письмо о заведении и о правке, но не об удалении: снятая
запись ничего не оставляет без человека, и «стоят: …» там было бы враньём."
```

---

### Task 5: Три типа события в журнале

**Files:**
- Modify: `shared/src/audit.ts` (`AUDIT_TYPES` и таблица `DESCRIBERS`)
- Modify: `shared/src/audit.test.ts`

**Interfaces:**
- Produces: типы `"self_entry_created"`, `"self_entry_updated"`, `"self_entry_deleted"` в `AuditType`, и их описатели в `describeAuditEvent`.

- [ ] **Step 1: Написать падающий тест**

Дописать в `shared/src/audit.test.ts`:

```ts
describe("самозапись работника в журнале", () => {
  const payload = {
    entryId: 7, employeeId: 3, employeeName: "Аня",
    date: "2026-08-12", endDate: "2026-08-14", category: "sick_leave", title: null, start: null, end: null,
  };

  it("читается как отдельное событие, а не как админская правка", () => {
    const self = describeAuditEvent("self_entry_created", payload);
    const byAdmin = describeAuditEvent("entry_created", payload);
    expect(self.title).not.toBe(byAdmin.title);
    expect(self.title.toLowerCase()).toContain("сам");
  });

  it("называет человека и срок", () => {
    const view = describeAuditEvent("self_entry_created", payload);
    expect(view.lines.join(" ")).toContain("Аня");
    expect(view.lines.join(" ")).toContain("12 авг");
  });

  it("правка показывает, что было и что стало", () => {
    const view = describeAuditEvent("self_entry_updated", {
      before: payload,
      after: { ...payload, endDate: "2026-08-16" },
    });
    expect(view.lines.join(" ")).toContain("16 авг");
  });

  it("снятие тоже описано, а не падает на неизвестный тип", () => {
    expect(describeAuditEvent("self_entry_deleted", payload).lines.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Прогнать — падает**

Run: `npx vitest run shared/src/audit.test.ts`
Expected: FAIL — типа нет в `AuditType`, TypeScript ругается ещё до прогона.

- [ ] **Step 3: Реализация**

В `shared/src/audit.ts` дописать три строки в `AUDIT_TYPES` рядом с `entry_*`:

```ts
export const AUDIT_TYPES = [
  "entry_created", "entry_updated", "entry_deleted",
  // Отдельно от админских `entry_*` намеренно: админ, читающий журнал, должен
  // различать «я это поставил» и «человек поставил себе сам», иначе строка не
  // отвечает на первый же вопрос, который к ней возникает.
  "self_entry_created", "self_entry_updated", "self_entry_deleted",
  // …остальное без изменений
```

Тело описателя `entry_updated` сегодня собирает строки прямо внутри таблицы. Вынести его в функцию рядом с `entryView`, чтобы новый тип не завёл вторую копию:

```ts
/** Строки правки записи: кто, когда, и что именно поменялось. */
function entryUpdatedLines(p: Record<string, unknown>): string[] {
  const before = obj(p.before);
  const after = obj(p.after);
  const lines = [`${personLabel(after)} · ${spanLabel(after)}`];
  if (num(before.employeeId) !== num(after.employeeId)) {
    lines.push(`работник: ${personLabel(before)} → ${personLabel(after)}`);
  }
  if (spanLabel(before) !== spanLabel(after)) {
    lines.push(`день: ${spanLabel(before)} → ${spanLabel(after)}`);
  }
  if (entryLabel(before) !== entryLabel(after)) {
    lines.push(`было: ${entryLabel(before)}`, `стало: ${entryLabel(after)}`);
  }
  return lines;
}
```

и в таблице:

```ts
  entry_updated: (p) => ({ icon: "✎", title: entryTitle("updated", obj(p.after)), lines: entryUpdatedLines(p) }),

  self_entry_created: (p) => ({ icon: "🙋", title: "Записал(а) себе сам(а)", lines: entryView(p) }),
  self_entry_updated: (p) => ({ icon: "🙋", title: "Поправил(а) свою запись сам(а)", lines: entryUpdatedLines(p) }),
  self_entry_deleted: (p) => ({ icon: "🙋", title: "Снял(а) свою запись сам(а)", lines: entryView(p) }),
```

- [ ] **Step 4: Прогнать**

Run: `npx vitest run shared/src/audit.test.ts`
Expected: PASS. Если в файле есть тест на полноту таблицы — он тоже обязан пройти; если он падает, значит описатель для какого-то из трёх типов не дописан.

- [ ] **Step 5: Гейт и коммит**

```bash
npm test && npm run typecheck && npm run lint
git add shared/src/audit.ts shared/src/audit.test.ts
git commit -m "feat(журнал): самозапись работника — три отдельных типа события

Отдельно от админских entry_*: админ, читающий журнал, должен различать «я это
поставил» и «человек поставил себе сам». Один тип на оба случая не отвечал бы
на первый же вопрос, который к строке возникает.

Тело описателя правки вынесено в функцию — иначе новый тип завёл бы вторую
копию той же логики прямо в соседней строке таблицы."
```

---

### Task 6: Три маршрута работника

**Files:**
- Create: `server/src/http/routes/my-entries.ts`, `server/src/http/routes/my-entries.test.ts`
- Modify: `server/src/util/message-lines.ts` (переезд `entryAuditPayload`)
- Modify: `server/src/http/app.ts` (снять локальный `auditShape`, смонтировать роутер)

**Interfaces:**
- Consumes: `selfEntryRefusal`, `selfEntryEditRefusal` (Task 1); `dayAfterLine` с `voice: "admins"` (Task 3); тексты из Task 4; типы журнала из Task 5.
- Produces:
  - `export function entryAuditPayload(db: Db, entry: Shift): Record<string, unknown>` в `message-lines.ts`
  - `export function createMyEntryRoutes(deps: { db: Db; config: Config; bot: Bot | null }): Hono<Env>`

- [ ] **Step 1: Перенести `auditShape` в общее место**

Сегодня это замыкание внутри `createApp` (`app.ts:637`), а новый роутер обязан писать в журнал **тот же самый** payload: две ручки, пишущие в один журнал по-разному, — дефект, который в этом репозитории уже ловился на обменах.

В `server/src/util/message-lines.ts` (там уже живёт `nameOf(db, employeeId)`) добавить:

```ts
/**
 * The fields worth keeping in the audit feed — enough to answer «что именно
 * поменяли» without copying the whole row into the log. The name, not just
 * `employeeId`: the journal is read by eye, and «работник #24» answers nothing.
 *
 * Lives here rather than inside `createApp` because a second entrance now
 * writes to the same feed. Two entrances shaping one journal differently is a
 * defect this repository has already paid for once, on swaps.
 */
export function entryAuditPayload(db: Db, s: Shift) {
  return {
    entryId: s.id, employeeId: s.employeeId,
    employeeName: s.employeeId != null ? nameOf(db, s.employeeId) : null,
    date: s.date, endDate: s.endDate,
    category: s.category, title: s.title, start: s.start, end: s.end,
  };
}
```

В `app.ts` удалить локальный `auditShape` и заменить его четыре вызова на `entryAuditPayload(db, …)`.

Run: `npm test`
Expected: столько же прошедших, сколько было до шага. Это чистый переезд.

- [ ] **Step 2: Написать падающий тест маршрутов**

Создать `server/src/http/routes/my-entries.test.ts`. Форму запроса взять из соседнего `server/src/http/entries.test.ts` (тот же `createApp`, тот же способ подписать initData/JWT) — скопировать его шапку целиком, чтобы не изобретать вторую.

```ts
describe("POST /api/my/entries", () => {
  it("refuses a category the worker does not own, and writes nothing", async () => {
    // тело с category: "shift" → 400, и в базе на этот день у него пусто
  });

  it("records the entry on the CALLER, whatever employeeId the body carries", async () => {
    // тело с employeeId чужого человека → 201, запись на вызывающем,
    // у чужого человека на этот день пусто
  });

  it("refuses a sick leave older than the backdating window", async () => {
    // date = сегодня минус 8 дней → 400
  });

  it("journals it as a self entry, not as an admin one", async () => {
    // audit_log последним событием — self_entry_created
  });
});

describe("PATCH /api/my/entries/:id", () => {
  it("answers 404 for somebody else's entry and leaves it alone", async () => { /* … */ });
  it("refuses to touch an entry that has already ended", async () => { /* … */ });
  it("extends a running sick leave", async () => { /* … */ });
});

describe("DELETE /api/my/entries/:id", () => {
  it("refuses to delete a shift", async () => { /* … */ });
  it("removes the worker's own event", async () => { /* … */ });
});
```

**Каждый тест обязан проверять состояние базы, а не только код ответа.** «400 и запись не создана» — два утверждения; тест, проверяющий только первое, пройдёт и на реализации, которая пишет запись и потом отвечает 400.

- [ ] **Step 3: Прогнать — падает**

Run: `npx vitest run server/src/http/routes/my-entries.test.ts`
Expected: FAIL — маршрутов нет, все ответы 404.

- [ ] **Step 4: Реализация роутера**

Создать `server/src/http/routes/my-entries.ts`:

```ts
import { Hono } from "hono";
import { z } from "zod";
import type { Bot } from "grammy";
import { dateStr, timeStr, selfEntryRefusal, selfEntryEditRefusal } from "@planer/shared";
import type { Config } from "../../config";
import type { Db } from "../../db/client";
import { createShift, getShift, updateShift, deleteShift } from "../../repo/shifts";
import { getEmployeeById } from "../../repo/employees";
import { recordAudit } from "../../repo/audit";
import { teamNow } from "../../util/team-time";
import { entryAuditPayload, nameOf } from "../../util/message-lines";
import { entryTimesError, entryDateError, entryRangeError } from "../entry-schema";
import { dayAfterLine } from "../../schedule/day-summary";
import { notifyAdmins } from "../../bot/notify";
import {
  selfEntryCreatedText, selfEntryUpdatedText, selfEntryDeletedText,
} from "../../schedule/self-entry-notice";
import { type Env, requireAuth } from "../middleware";
import { eachDayIso } from "@planer/shared";

/**
 * Two shapes, one per category, and `employeeId` is in NEITHER.
 *
 * It comes from the token instead. Not «ignored» and not «overwritten» —
 * absent, so there is nothing to smuggle a colleague's id through. «Кому» is the
 * single field that separates this from the admin route, and a worker booking a
 * sick leave for somebody else is the whole risk of the feature.
 *
 * A narrow schema rather than `createEntrySchema.partial()`: that one accepts
 * `templateId`, `employeeId` and all seven categories, so any future widening of
 * the admin schema would silently widen what a worker may write.
 */
const sickBody = z.object({
  category: z.literal("sick_leave"),
  date: dateStr,
  endDate: dateStr.nullish(),
});

const eventBody = z.object({
  category: z.literal("offsite"),
  date: dateStr,
  start: timeStr,
  end: timeStr,
  title: z.string().trim().min(1).max(200),
  location: z.string().trim().max(200).nullish(),
});

const selfEntryBody = z.discriminatedUnion("category", [sickBody, eventBody]);

export function createMyEntryRoutes(deps: { db: Db; config: Config; bot: Bot | null }): Hono<Env> {
  const { db, config, bot } = deps;
  const routes = new Hono<Env>();

  /** Every day the entry covers that still holds something else. */
  function riskLines(employeeId: number, entry: { id: number; date: string; endDate: string | null }): string[] {
    return eachDayIso(entry.date, entry.endDate ?? entry.date)
      .map((date) => dayAfterLine(db, { employeeId, date, keepSilentForEntryId: entry.id, voice: "admins" }))
      .filter((line): line is string => line !== null);
  }

  routes.post("/api/my/entries", requireAuth(db, config.jwtSecret), async (c) => {
    const parsed = selfEntryBody.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "invalid", issues: parsed.error.issues }, 400);
    const body = parsed.data;
    const employeeId = c.get("auth").employeeId;
    const today = teamNow(config.teamTz).date;

    const refusal = selfEntryRefusal(body, today);
    if (refusal) return c.json({ error: refusal }, 400);
    const shapeError = entryTimesError(body) ?? entryDateError(body) ?? entryRangeError(body);
    if (shapeError) return c.json({ error: shapeError }, 400);

    const entry = createShift(db, { ...body, employeeId });
    recordAudit(db, "self_entry_created", employeeId, entryAuditPayload(db, entry));
    if (bot) {
      await notifyAdmins(bot, db, selfEntryCreatedText(
        nameOf(db, employeeId) ?? "Работник",
        entry,
        riskLines(employeeId, entry),
      ));
    }
    return c.json({ entry }, 201);
  });

  routes.patch("/api/my/entries/:id", requireAuth(db, config.jwtSecret), async (c) => {
    const parsed = selfEntryBody.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "invalid", issues: parsed.error.issues }, 400);
    const body = parsed.data;
    const employeeId = c.get("auth").employeeId;
    const id = Number(c.req.param("id"));
    const existing = getShift(db, id);
    // A stranger's entry and a missing one get the same answer. Confirming that
    // somebody else's entry exists is not this worker's business, and `403` here
    // would confirm exactly that.
    if (!existing || existing.employeeId !== employeeId) return c.json({ error: "not_found" }, 404);
    // The category is not editable: turning one's own sick leave into an event
    // (or back) is a different record, and the two forms differ in every field.
    if (existing.category !== body.category) return c.json({ error: "Вид записи менять нельзя" }, 400);

    const today = teamNow(config.teamTz).date;
    // BOTH rules, and this is not belt-and-braces. `selfEntryEditRefusal` asks
    // whether the OLD record may still be touched; `selfEntryRefusal` asks where
    // it is being moved TO. With only the first, an entry that ends today could
    // be dragged a year into the future; with only the second, a sick leave that
    // ended last month could be edited as long as the new dates look fine.
    const editRefusal = selfEntryEditRefusal(existing, today);
    if (editRefusal) return c.json({ error: editRefusal }, 400);
    const moveRefusal = selfEntryRefusal(body, today);
    if (moveRefusal) return c.json({ error: moveRefusal }, 400);
    const shapeError = entryTimesError(body) ?? entryDateError(body) ?? entryRangeError(body);
    if (shapeError) return c.json({ error: shapeError }, 400);

    const before = entryAuditPayload(db, existing);
    // `endDate: null` and `location: null` must reach the row: dropping «по какое»
    // has to actually shorten a sick leave, and `?? undefined` would silently keep
    // the old value — the update path would then be unable to undo anything.
    const updated = updateShift(db, id, {
      date: body.date,
      endDate: body.category === "sick_leave" ? (body.endDate ?? null) : null,
      start: body.category === "offsite" ? body.start : null,
      end: body.category === "offsite" ? body.end : null,
      title: body.category === "offsite" ? body.title : null,
      location: body.category === "offsite" ? (body.location ?? null) : null,
    });
    if (!updated) return c.json({ error: "not_found" }, 404);

    recordAudit(db, "self_entry_updated", employeeId, { before, after: entryAuditPayload(db, updated) });
    if (bot) {
      await notifyAdmins(bot, db, selfEntryUpdatedText(
        nameOf(db, employeeId) ?? "Работник",
        existing,
        updated,
        riskLines(employeeId, updated),
      ));
    }
    return c.json({ entry: updated });
  });

  routes.delete("/api/my/entries/:id", requireAuth(db, config.jwtSecret), async (c) => {
    const employeeId = c.get("auth").employeeId;
    const id = Number(c.req.param("id"));
    // Read it before it is gone — the journal has to be able to say what went.
    const existing = getShift(db, id);
    if (!existing || existing.employeeId !== employeeId) return c.json({ error: "not_found" }, 404);
    const refusal = selfEntryEditRefusal(existing, teamNow(config.teamTz).date);
    if (refusal) return c.json({ error: refusal }, 400);

    // Normally empty here: only `sick_leave` and `offsite` are deletable by a
    // worker, and neither is swappable, so no pending swap can point at one.
    // Not ASSUMED empty, though — an admin re-categorising a shift that already
    // carried a pending swap makes this reachable, and the admin delete route
    // does exactly this. Two delete paths handling one swap differently is the
    // same class of defect as two journals.
    const linesBefore = new Map(listPendingSwapsForShift(db, id).map((r) => [r.id, swapAuditPayload(db, r)]));
    const { deleted, expiredSwaps } = deleteShift(db, id);
    if (!deleted) return c.json({ error: "not_found" }, 404);
    recordAudit(db, "self_entry_deleted", employeeId, entryAuditPayload(db, existing));

    for (const request of expiredSwaps) {
      const payload = linesBefore.get(request.id) ?? swapAuditPayload(db, request);
      recordAudit(db, "swap_expired", employeeId, payload);
      if (!bot) continue;
      for (const side of [request.fromEmployeeId, request.toEmployeeId]) {
        const tg = getEmployeeById(db, side)?.telegramUserId ?? null;
        if (tg != null) await notifyUser(bot, tg, swapExpiredText(payload, "entry_deleted"));
      }
    }

    if (bot) {
      await notifyAdmins(bot, db, selfEntryDeletedText(nameOf(db, employeeId) ?? "Работник", existing));
    }
    return c.json({ ok: true });
  });

  return routes;
}
```

Импорты, которых нет в наброске выше и которые понадобятся: `listPendingSwapsForShift` из `../../repo/swaps`, `swapAuditPayload` из `../../util/message-lines`, `notifyUser` и `swapExpiredText` из `../../bot/notify`.

- [ ] **Step 5: Смонтировать роутер**

В `app.ts` рядом с `createReadRoutes`:

```ts
  app.route("/", createMyEntryRoutes({ db, config, bot }));
```

- [ ] **Step 6: Прогнать тесты маршрутов**

Run: `npx vitest run server/src/http/routes/my-entries.test.ts`
Expected: PASS, 9 тестов.

- [ ] **Step 7: Гейт и коммит**

```bash
npm test && npm run typecheck && npm run lint
git add server/src/http/routes/my-entries.ts server/src/http/routes/my-entries.test.ts server/src/util/message-lines.ts server/src/http/app.ts
git commit -m "feat(api): работник ставит себе больничный и мероприятие

Три маршрута под requireAuth, отдельным роутером — app.ts на треке A резали,
обратно наращивать его незачем.

employeeId берётся из токена и в схему тела НЕ ВХОДИТ. Не «игнорируется» и не
«перетирается» — его там нет, поэтому подставить чужой id нечем. «Кому» —
единственное поле, которое отличает самозапись от админской ручки.

Схема узкая и своя, а не createEntrySchema.partial(): та принимает templateId,
employeeId и все семь категорий, и любая будущая правка админской схемы молча
расширила бы права работника.

auditShape переехал из замыкания createApp в message-lines как
entryAuditPayload: теперь в журнал пишут две ручки, и писать они обязаны
одинаково. Две ручки, шейпящие один журнал по-разному, этот репозиторий уже
проходил на обменах."
```

---

### Task 7: Экран в мини-аппе

**Files:**
- Create: `miniapp/src/screens/SelfEntryScreen.tsx`, `miniapp/src/screens/self-entry.test.ts`
- Modify: `miniapp/src/App.tsx` (оверлей и разбор `?screen=`), `miniapp/src/api/client.ts` и `miniapp/src/api/mock.ts` (три метода)

Слой 2: логика — тестами, вёрстка — нет.

- [ ] **Step 1: Тест на логику формы**

Создать `miniapp/src/screens/self-entry.test.ts` — про две чистые функции, которые надо вынести из компонента, а не про рендер:

```ts
import { describe, it, expect } from "vitest";
import { defaultEventEnd, screenFromSearch } from "./SelfEntryScreen";

describe("форма мероприятия", () => {
  it("конец предзаполняется как «начало + 2 часа»", () => {
    expect(defaultEventEnd("14:00")).toBe("16:00");
  });

  it("поздний старт не уезжает за полночь", () => {
    // 23:30 + 2ч = 01:30 следующего дня, а запись однодневная —
    // упираем в конец суток, а не молча создаём перевёрнутый диапазон.
    expect(defaultEventEnd("23:30")).toBe("23:59");
  });
});

describe("вход по кнопке из бота", () => {
  it("?screen=sick открывает форму больничного", () => {
    expect(screenFromSearch("?screen=sick")).toBe("sick");
  });
  it("?screen=event открывает форму мероприятия", () => {
    expect(screenFromSearch("?screen=event")).toBe("event");
  });
  it("мусор не открывает ничего", () => {
    expect(screenFromSearch("?screen=%D1%84%D1%8B%D0%B2")).toBeNull();
    expect(screenFromSearch("")).toBeNull();
  });
});
```

- [ ] **Step 2: Прогнать — падает**

Run: `npx vitest run miniapp/src/screens/self-entry.test.ts`
Expected: FAIL — модуля нет.

- [ ] **Step 3: Реализация экрана**

Две чистые функции экспортируются рядом с компонентом:

```tsx
/**
 * Конец мероприятия по его началу.
 *
 * Владелец просил у формы только время начала. Конец всё равно обязателен —
 * запись без него не участвует в проверке пересечений и висит в балансе нулём,
 * то есть попадает в тот же сорт, что нечитаемая ячейка ростера. Поэтому поле
 * есть, но заполнено заранее: согласен — не трогаешь.
 *
 * Упор в 23:59, а не переход через полночь: форма однодневная, и «01:30»
 * молча создало бы перевёрнутый диапазон, который сервер тут же отвергнет.
 */
export function defaultEventEnd(start: string): string {
  const [h, m] = start.split(":").map(Number);
  if (!Number.isInteger(h) || !Number.isInteger(m)) return start;
  const minutes = h * 60 + m + 120;
  // Не переходим через полночь: форма однодневная.
  if (minutes >= 24 * 60) return "23:59";
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/**
 * Какую форму открыть сразу, если пришли по кнопке из бота.
 *
 * Строка запроса, а не фрагмент: фрагмент у мини-аппа занят самим Telegram —
 * initData приезжает именно в нём.
 */
export function screenFromSearch(search: string): "sick" | "event" | null {
  const value = new URLSearchParams(search).get("screen");
  return value === "sick" || value === "event" ? value : null;
}
```

Сам компонент — оверлей поверх «Моих смен», формой и кнопкой «назад» повторяющий `ProposeSwapScreen`. Список своих будущих записей этих двух категорий берётся из уже загруженного ответа `/api/my/shifts` — отдельной ручки не нужно; «Изменить»/«Удалить» показываются только когда `selfEntryEditRefusal` из `@planer/shared` вернул `null`.

**Ошибку рисовать рядом с кнопкой, а не в шапке экрана.** Мини-апп — один длинный скролл без единого `position: fixed`, и сообщение, отрисованное вверху по нажатию внизу, человеку невидимо. Этот класс дефекта в репозитории ловился трижды.

- [ ] **Step 4: Три метода клиента и мока**

`createSelfEntry`, `updateSelfEntry`, `deleteSelfEntry` в `miniapp/src/api/client.ts` и их пара в `miniapp/src/api/mock.ts`. Мок обязан отвечать теми же отказами, что и сервер, — он зовёт ту же `selfEntryRefusal` из `@planer/shared`.

- [ ] **Step 5: Прогнать и гейт**

```bash
npx vitest run miniapp/src/screens/self-entry.test.ts
npm test && npm run typecheck && npm run lint
```

- [ ] **Step 6: Коммит**

```bash
git add miniapp/src
git commit -m "feat(мини-апп): форма больничного и мероприятия

Оверлей поверх «Моих смен», как «Предложить обмен»: не вкладка, со своей
кнопкой «назад».

Конец мероприятия предзаполняется как «начало + 2 часа» и упирается в 23:59:
владелец просил только начало, но запись без конца попадает в тот же сорт, что
нечитаемая ячейка ростера — не участвует в пересечениях и висит в балансе
нулём. Поэтому поле есть, но заполнено заранее.

«Изменить» показывается ровно там, где сервер разрешит правку: обе стороны
спрашивают одну функцию из shared."
```

---

### Task 8: Кнопки в боте

**Files:**
- Modify: `server/src/bot/keyboard.ts`, `server/src/bot/keyboard.test.ts`

- [ ] **Step 1: Тест**

Дописать в `server/src/bot/keyboard.test.ts`:

```ts
it("даёт вход в больничный и в мероприятие, и каждый ведёт в свою форму", () => {
  const kb = mainKeyboard({ isAdmin: false, publicUrl: "https://x.test" });
  const buttons = kb.keyboard.flat();
  expect(buttons.find((b) => labelOf(b) === BTN_SICK)).toMatchObject({
    web_app: { url: "https://x.test/app/?screen=sick" },
  });
  expect(buttons.find((b) => labelOf(b) === BTN_EVENT)).toMatchObject({
    web_app: { url: "https://x.test/app/?screen=event" },
  });
});
```

- [ ] **Step 2: Прогнать — падает**

Run: `npx vitest run server/src/bot/keyboard.test.ts`
Expected: FAIL — `BTN_SICK` не экспортируется.

- [ ] **Step 3: Реализация**

В `keyboard.ts` добавить две метки и две `web_app`-кнопки:

```ts
export const BTN_SICK = "🤒 Больничный";
export const BTN_EVENT = "📌 Мероприятие";
```

и строку в раскладке. Порядок: график и мои смены первыми (их жмут каждый день), больничный и мероприятие второй строкой, напоминания третьей, админка последней.

**Существующий тест «работник получает график, мини-апп и напоминания — и ничего сверх того» после этого обязан покраснеть** — он сверяет полный список меток. Это правильно: он и написан, чтобы новая кнопка не появилась незамеченной. Обновить ожидание, а не ослабить проверку.

- [ ] **Step 4: Прогнать, гейт, коммит**

```bash
npx vitest run server/src/bot/keyboard.test.ts
npm test && npm run typecheck && npm run lint
git add server/src/bot/keyboard.ts server/src/bot/keyboard.test.ts
git commit -m "feat(бот): кнопки «Больничный» и «Мероприятие»

Первая спека обещала добавить их именно здесь и объяснила почему: кнопка,
ведущая в ненаписанный экран, хуже отсутствующей. Экран написан — кнопки
появились.

Строкой запроса, а не фрагментом: фрагмент у мини-аппа занят самим Telegram,
initData приезжает именно в нём."
```

---

## Самопроверка плана

Пройдено по спеке; всё, что она обещает, лежит в задачах:

| Обещание спеки | Где |
| --- | --- |
| Правило в `shared`, зовут оба | Task 1, используется в Task 6 и Task 7 |
| Три маршрута, `employeeId` из токена | Task 6 |
| Узкие схемы по категориям | Task 6 |
| Письмо админам со строками про день | Task 3 + Task 4 + Task 6 |
| Подпись «Мероприятие» | Task 2 |
| Экран в мини-аппе | Task 7 |
| Кнопки в боте | Task 8 |
| Три типа журнала | Task 5 |

**Две вещи, которых спека не предусмотрела, и они добавлены сюда:**

1. **Сторож копии подписей в консоли** (Task 2). В мини-аппе он был, в консоли нет — а переименование затрагивает обе. Без него консоль тихо осталась бы со старым словом.
2. **Переезд `auditShape`** (Task 6, шаг 1). Спека говорила «пишем в журнал», не заметив, что шейпер — замыкание внутри `createApp` и второму роутеру недоступен. Копия шейпера означала бы две ручки, пишущие в один журнал по-разному.

**Одно расхождение со спекой, поправленное в спеке** (Task 3, шаг 5): голос строки про день меняет не только зачин, но и состав списка.

## Что разошлось с планом на задачах 7–8

Записано по факту исполнения 2026-08-12, чтобы следующий заход читал правду, а не
обещание.

1. **Третья чистая функция: `mySelfEntries(shifts, today)`.** План называл две
   (`defaultEventEnd`, `screenFromSearch`) и оставлял «показывать „Изменить“ там, где
   `selfEntryEditRefusal` вернул `null`» внутри вёрстки. Но это и есть логика — то самое,
   что на слое 2 покрывается тестом, — и в компоненте она была бы непроверяемой. Функция
   спрашивает ту же `selfEntryEditRefusal` и сортирует по дате.

2. **Добавлен DOM-тест `self-entry-deeplink.test.tsx`.** План проверял `screenFromSearch`
   напрямую, а зовёт ли её приложение — не проверял ничто. Между тем вся задача 8 стоит
   ровно на этой связке: кнопка бота, приводящая в список смен вместо формы, выглядит
   работающей ссылкой. Тест проверен `git stash push miniapp/src/App.tsx` — без правки
   краснеют два его случая из трёх (третий, «без строки запроса», обязан зеленеть и там).
   **Заодно поймана пустая проверка в нём же:** отрицание `not.toContain("Осталось на этой
   неделе")` проходило бы и без оверлея — у человека без смен эта строка не рисуется
   вовсе. Маркером «Моих смен» взято приветствие.

3. **Вход в форму из самого мини-аппа — две кнопки над списком смен.** План описывал
   только оверлей и кнопки бота, то есть форма открывалась бы исключительно из чата: тот,
   кто уже стоит в мини-аппе, должен был бы выйти в бота, чтобы поставить себе больничный.
   Кнопки стоят НАД списком — список ближайших смен не имеет нижней границы, и кнопка под
   ним у человека с плотным графиком уехала бы за десяток экранов прокрутки.

4. **Один компонент на обе формы, и категория правки берётся у самой записи.** Список
   «что ты уже записал себе» показывает обе категории (иначе снять мероприятие можно было
   бы только из «Мероприятия», хотя человек уже стоит в форме), поэтому при нажатии
   «Изменить» форма переключается на категорию записи, а не на ту, ради которой экран
   открыли.

5. **Тип `SelfEntryInput` в `client.ts`** — объединение по категории, зеркало серверного
   `selfEntryBody`. Не `NewEntryInput`: та принимает `templateId`, `employeeId` и все семь
   категорий, и любое её будущее расширение молча расширило бы права работника.

## Что делать после

1. `superpowers:finishing-a-development-branch`.
2. Деплой по рецепту из памяти: бэкап `.backup` → **рестарт сначала**, фронты потом → сверить хеши бандлов локально и по публичному URL.
3. **Миграций в этой работе нет** — рестарт будет чистой перезагрузкой кода.
4. Заход 3 — передача смены и эскалация. Спеки ещё нет.
