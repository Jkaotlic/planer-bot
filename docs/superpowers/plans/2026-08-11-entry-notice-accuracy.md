# Уведомления о правке графика говорят правду — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** письмо о правке графика называет вид записи своим словом, показывает, что в
итоге стоит у человека на этот день, и приходит одно на серию правок вместо письма на
каждую.

**Architecture:** слово по категории — чистая функция в `@planer/shared` рядом с
`categoryLabel`. Тексты писем остаются в `server/src/schedule/change-notice.ts`. Буфер —
отдельный модуль `server/src/schedule/notice-buffer.ts`, который владеет таймерами и
делегирует отправку уже существующему `notifyScheduleChange`; роутам он виден как одна
функция «зарегистрируй правку».

**Tech Stack:** TypeScript 5.9 (ESM, npm workspaces), zod 3.25, vitest 4.1, Hono 4,
Drizzle + better-sqlite3, React 18 + Vite 8, grammy.

**Спека:** `docs/superpowers/specs/2026-08-11-entry-notice-accuracy-design.md`
**Ветка:** `feature/entry-notice-accuracy` (создана, спека на ней закоммичена)

## Global Constraints

- **Слой 1 — TDD обязателен.** Каждая задача: сначала падающий тест, потом минимальная
  реализация. «Посмотрел код, должно работать» доказательством не является.
- **Каждый новый тест обязан быть проверен на падение.** После зелёного прогона —
  сломать реализацию точечно (`git stash push <файл>` или правка одной строки) и
  убедиться, что краснеет **нужный** assert, а не соседний. Это повторяющийся дефект
  планов в этом репозитории; см. раздел «Ловушки» ниже.
- **Идентификаторы только латиницей.** В репозитории нет ни одного кириллического имени
  переменной — включая тестовые фикстуры. План написан по-русски и легко протаскивает
  `const отпуск`; так делать нельзя.
- **Комментарии в `server/src/**` — по-английски**, и в коде, и в тестах; русские
  доменные термины только в «ёлочках» внутри английской фразы. В `shared/` и в мини-аппе
  русские комментарии — принятая конвенция. Ревьюеры трижды ловили русские комментарии
  именно в тестовых файлах: самопроверка грепает реализацию и забывает про тест рядом.
- **Текст, который читает человек, — по-русски.**
- **Никаких настоящих ФИО.** Репозиторий публичный, сторож —
  `server/src/db/no-real-names.test.ts`. В фикстурах — «Аня», «Игорь», «Марк».
- **Бот ничего не запрещает.** Ни одна задача не добавляет отказов на пересечение
  записей. Решение владельца, процитировано в спеке.
- Тесты гоняются из корня: `npx vitest run <путь>`; вся сюита — `npm test`; типы —
  `npm run typecheck`; линтер — `npm run lint`.
- Коммитить после каждой задачи, сообщение — по-русски, в стиле истории репозитория.
- Ни одна задача не заканчивается красным гейтом.

## Ловушки, на которых этот репозиторий уже горел

1. **`expect(x).rejects.toThrow(CONST)`, где `CONST` импортируется из чинимого файла.**
   Без починки экспорта нет, `CONST` = `undefined`, а `toThrow(undefined)` проходит на
   любой ошибке.
2. **Тест, которому окружение даёт тот же результат, что и починка.** Свежий пример из
   этого же репозитория: тест ждал «нет связи», подменяя `fetch`, и зеленел без подмены
   вообще — в jsdom настоящий запрос падает сам.
3. **Фикстура, в которой проверяемое условие тривиально ложно.** Тест «две записи в один
   день» на фикстуре с одной записью проверяет не то, что назван.
4. **`npm test` после правки мока или фикстуры — `typecheck` недостаточно.** Моки
   покрыты тестами, которые типы не видят.

---

## Структура файлов

| Файл | Ответственность | Задача |
| --- | --- | --- |
| `shared/src/category.ts` | `categoryAccusative`, `categoryPossessive` | 1 |
| `shared/src/category.test.ts` | полнота таблиц по всем категориям | 1 |
| `server/src/util/message-lines.ts` | экспорт `dayLabel` (был приватным) | 3 |
| `server/src/schedule/change-notice.ts` | тексты писем, причина `manual`, итог дня | 2, 3, 4 |
| `server/src/schedule/change-notice.test.ts` | тексты | 2, 3 |
| `server/src/schedule/day-summary.ts` | **новый:** «что осталось на этот день» | 3 |
| `server/src/schedule/day-summary.test.ts` | **новый** | 3 |
| `server/src/schedule/notice-buffer.ts` | **новый:** окно 20 с, накопление по человеку | 4 |
| `server/src/schedule/notice-buffer.test.ts` | **новый:** поддельные таймеры | 4 |
| `server/src/http/app.ts` | три роута записи ходят через буфер | 5 |
| `server/src/http/entries.test.ts` | сценарий пяти правок целиком | 5, 6 |
| `miniapp/src/lib/shift.ts` | `notifyPendingNotice` — «уйдёт» вместо «дошло» | 5 |
| `miniapp/src/lib/shift.test.ts` | оба текста | 5 |
| `miniapp/src/screens/admin/AdminScheduleScreen.tsx` | одиночное сохранение — новый текст | 5 |

---

## Задача 1: слово по категории

Сегодня все три текста говорят «смену» независимо от того, что правили. Нужны две формы:
винительный без местоимения («поставил(а) тебе **смену**», «снял(а) с тебя **отпуск**») и
винительный с местоимением («изменил(а) **твою смену**», «изменил(а) **твой отпуск**») —
род у категорий разный, одной формой не обойтись.

**Files:**
- Modify: `shared/src/category.ts`
- Modify: `shared/src/category.test.ts`

**Interfaces:**
- Consumes: `EntryCategory`, `entryCategorySchema` — уже есть в этом файле.
- Produces: `categoryAccusative(category: EntryCategory): string` и
  `categoryPossessive(category: EntryCategory): string`. Их зовёт задача 2.

- [ ] **Step 1: Написать падающий тест**

Дописать в конец `shared/src/category.test.ts`:

```ts
describe("склонения категорий для писем", () => {
  it("винительный падеж — то, что подставляется после «поставил(а) тебе»", () => {
    expect(categoryAccusative("shift")).toBe("смену");
    expect(categoryAccusative("duty")).toBe("дежурство");
    expect(categoryAccusative("vacation")).toBe("отпуск");
    expect(categoryAccusative("sick_leave")).toBe("больничный");
    expect(categoryAccusative("offsite")).toBe("выездное мероприятие");
    expect(categoryAccusative("business_trip")).toBe("командировку");
    expect(categoryAccusative("weekend_work")).toBe("работу в выходной");
  });

  it("винительный с «твой» — род у категорий разный, одной формой не обойтись", () => {
    expect(categoryPossessive("shift")).toBe("твою смену");
    expect(categoryPossessive("duty")).toBe("твоё дежурство");
    expect(categoryPossessive("vacation")).toBe("твой отпуск");
    expect(categoryPossessive("sick_leave")).toBe("твой больничный");
    expect(categoryPossessive("offsite")).toBe("твоё выездное мероприятие");
    expect(categoryPossessive("business_trip")).toBe("твою командировку");
    expect(categoryPossessive("weekend_work")).toBe("твою работу в выходной");
  });

  // Таблица, забытая при добавлении категории, — это письмо со словом `undefined`
  // в чате у человека. Перебор по схеме ловит это на компиляции набора, а не в проде.
  it("обе таблицы покрывают все категории, какие есть", () => {
    for (const category of entryCategorySchema.options) {
      expect(categoryAccusative(category)).toMatch(/\S/);
      expect(categoryPossessive(category)).toMatch(/\S/);
    }
  });
});
```

Импорт в шапке файла дополнить: `categoryAccusative`, `categoryPossessive`,
`entryCategorySchema` — проверить, что уже импортировано, и добавить недостающее.

- [ ] **Step 2: Прогнать — тест должен упасть**

Run: `npx vitest run shared/src/category.test.ts`
Expected: FAIL — `categoryAccusative is not a function` (или ошибка импорта).

- [ ] **Step 3: Написать реализацию**

В `shared/src/category.ts` после `categoryLabel`:

```ts
/**
 * Категория в винительном падеже: «поставил(а) тебе смену», «снял(а) с тебя отпуск».
 *
 * Отдельно от `CATEGORY_LABELS`, а не падежом от неё: «Работа в выходной» →
 * «работу в выходной» правилом не выводится, а таблица из семи строк дешевле
 * любого правила и читается глазами.
 */
const CATEGORY_ACCUSATIVE: Record<EntryCategory, string> = {
  shift: "смену",
  vacation: "отпуск",
  sick_leave: "больничный",
  duty: "дежурство",
  offsite: "выездное мероприятие",
  business_trip: "командировку",
  weekend_work: "работу в выходной",
};

/** Та же форма с «твой/твоя/твоё»: род у категорий разный, и склеить его правилом нельзя. */
const CATEGORY_POSSESSIVE: Record<EntryCategory, string> = {
  shift: "твою смену",
  vacation: "твой отпуск",
  sick_leave: "твой больничный",
  duty: "твоё дежурство",
  offsite: "твоё выездное мероприятие",
  business_trip: "твою командировку",
  weekend_work: "твою работу в выходной",
};

export function categoryAccusative(category: EntryCategory): string {
  return CATEGORY_ACCUSATIVE[category];
}

export function categoryPossessive(category: EntryCategory): string {
  return CATEGORY_POSSESSIVE[category];
}
```

- [ ] **Step 4: Прогнать — тест должен пройти**

Run: `npx vitest run shared/src/category.test.ts`
Expected: PASS.

- [ ] **Step 5: Проверить, что тест умеет падать**

Убрать одну строку из `CATEGORY_ACCUSATIVE` (например `weekend_work`), прогнать —
краснеть должны первый и третий случаи. Вернуть строку.

- [ ] **Step 6: Гейт и коммит**

Run: `npm test && npm run typecheck && npm run lint`
Expected: PASS.

```bash
git add shared/src/category.ts shared/src/category.test.ts
git commit -m "feat(shared): склонения категорий для писем о правке графика"
```

---

## Задача 2: тексты писем называют вид записи

**Files:**
- Modify: `server/src/schedule/change-notice.ts:18-29`
- Modify: `server/src/schedule/change-notice.test.ts`

**Interfaces:**
- Consumes: `categoryAccusative`, `categoryPossessive` (задача 1).
- Produces: `entryAddedText(actorName, entry)`, `entryRemovedText(actorName, entry)`,
  `entryChangedText(actorName, before, after)` — **сигнатуры меняются**: вместо готовой
  строки функции принимают саму запись, потому что слово берётся из её категории.
  Их зовут задачи 3, 4 и существующий `scheduleSummaryText`.

- [ ] **Step 1: Написать падающие тесты**

Дописать в `server/src/schedule/change-notice.test.ts`:

```ts
const dayShift = {
  date: "2026-08-12", endDate: null, start: "09:00", end: "18:00",
  category: "shift" as const, title: "День",
};
const vacation = {
  date: "2026-08-10", endDate: "2026-08-14", start: null, end: null,
  category: "vacation" as const, title: null,
};

describe("письмо называет вид записи", () => {
  it("смену — сменой", () => {
    expect(entryAddedText("Аня", dayShift)).toBe(
      "Аня поставил(а) тебе смену: Ср 12 авг · 09:00–18:00 · День.",
    );
  });

  it("отпуск — отпуском, а не «сменой»", () => {
    expect(entryRemovedText("Аня", vacation)).toBe(
      "Аня снял(а) с тебя отпуск: Пн 10 авг – Пт 14 авг · весь день · Отпуск.",
    );
  });

  it("правка внутри одной категории говорит «изменил твою смену»", () => {
    const moved = { ...dayShift, start: "11:00", end: "20:00", title: "Вечер" };
    expect(entryChangedText("Аня", dayShift, moved)).toBe(
      "Аня изменил(а) твою смену: было Ср 12 авг · 09:00–18:00 · День → стало Ср 12 авг · 11:00–20:00 · Вечер.",
    );
  });

  it("смена категории говорится прямо: заменил отпуск на смену", () => {
    // Ровно тот случай, с которого началась работа: человек прочитал
    // «изменил твою смену» про свой отпуск и не понял, отменён ли отпуск.
    const replaced = { ...dayShift, date: "2026-08-10" };
    expect(entryChangedText("Аня", vacation, replaced)).toBe(
      "Аня заменил(а) твой отпуск на смену: было Пн 10 авг – Пт 14 авг · весь день · Отпуск → стало Пн 10 авг · 09:00–18:00 · День.",
    );
  });
});
```

- [ ] **Step 2: Прогнать — тесты должны упасть**

Run: `npx vitest run server/src/schedule/change-notice.test.ts`
Expected: FAIL — четыре новых случая. Старые случаи файла тоже покраснеют, если они
зовут эти функции со строкой: сигнатура изменилась. Это ожидаемо и чинится в шаге 3.

- [ ] **Step 3: Переписать три функции**

В `server/src/schedule/change-notice.ts` заменить строки 18-29:

```ts
/** Just enough of an entry to write a line about it. */
type EntryLike = Parameters<typeof entryLineOf>[0];

/**
 * Род автора правки неизвестен: у работника есть имя, но не пол, и заводить
 * ради писем колонку «пол» — цена выше пользы. Форма `поставил(а)` уже принята
 * в этом боте (`отдал(а)`, `отказался(лась)` в `bot/notify.ts`), поэтому письма
 * про график говорят так же, а не «Антон поставила тебе смену».
 *
 * The word for the entry itself comes from its category. Until 2026-08-11 all
 * three texts said «смену» regardless — a worker read «изменил твою смену»
 * about his own «отпуск» and could not tell whether the holiday was cancelled.
 */
export function entryAddedText(actorName: string, entry: EntryLike): string {
  return `${actorName} поставил(а) тебе ${categoryAccusative(entry.category)}: ${entryLineOf(entry)}.`;
}

export function entryRemovedText(actorName: string, entry: EntryLike): string {
  return `${actorName} снял(а) с тебя ${categoryAccusative(entry.category)}: ${entryLineOf(entry)}.`;
}

/**
 * Называет и «было», и «стало»: человеку важно, что именно у него поменялось.
 *
 * A changed category is said outright — «заменил(а) твой отпуск на смену» —
 * because «изменил(а) твой отпуск … стало День» stays unreadable even with the
 * right noun.
 */
export function entryChangedText(actorName: string, before: EntryLike, after: EntryLike): string {
  const verb =
    before.category === after.category
      ? `изменил(а) ${categoryPossessive(before.category)}`
      : `заменил(а) ${categoryPossessive(before.category)} на ${categoryAccusative(after.category)}`;
  return `${actorName} ${verb}: было ${entryLineOf(before)} → стало ${entryLineOf(after)}.`;
}
```

Импорт в шапке дополнить: `categoryAccusative`, `categoryPossessive` из `@planer/shared`.

Поправить вызовы внутри файла — в `notifyEntryChange` (строки 70-72) и
`scheduleSummaryText` (строки 127-130) убрать обёртку `entryLineOf(...)`, передавая саму
запись. `npm run typecheck` покажет все места.

- [ ] **Step 4: Прогнать домен**

Run: `npx vitest run server/src/schedule/`
Expected: PASS — новые и старые случаи.

- [ ] **Step 5: Проверить, что тесты умеют падать**

Заменить в `entryChangedText` ветку смены категории на безусловное
`изменил(а) ${categoryPossessive(before.category)}` — краснеть должен ровно четвёртый
случай. Вернуть.

- [ ] **Step 6: Гейт и коммит**

Run: `npm test && npm run typecheck && npm run lint`
Expected: PASS. Упавшие чужие тесты на старых текстах чинятся здесь же — они ждали
слова «смену» про отпуск, то есть ждали неправды.

```bash
git add server/src/schedule shared/src
git commit -m "fix(уведомления): письмо называет вид записи, а не всё подряд «сменой»"
```

---

## Задача 3: итог дня в письме

**Files:**
- Create: `server/src/schedule/day-summary.ts`, `server/src/schedule/day-summary.test.ts`
- Modify: `server/src/util/message-lines.ts` (экспорт `dayLabel`)
- Modify: `server/src/schedule/change-notice.ts`

**Interfaces:**
- Consumes: `dayLabel` из `message-lines`, `listShiftsOverlapping` из `repo/shifts`.
- Produces: `dayAfterLine(db, { employeeId, date, keepSilentForEntryId }): string | null`.
  Её зовут задачи 4 и 5 через `notifyEntryChange`.

- [ ] **Step 1: Экспортировать `dayLabel`**

В `server/src/util/message-lines.ts` строка 8 — `function dayLabel` становится
`export function dayLabel`. Тело не трогать: строка итога обязана называть день теми же
словами, что и `entryLineOf` в том же письме.

- [ ] **Step 2: Написать падающий тест**

Создать `server/src/schedule/day-summary.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { makeTestDb } from "../db/testdb";
import { createEmployee } from "../repo/employees";
import { createShift } from "../repo/shifts";
import { dayAfterLine } from "./day-summary";

const DAY = "2026-08-12";

describe("что осталось у человека на этот день", () => {
  it("две записи — перечисляет обе, потому что человек про это ещё не знает", () => {
    const db = makeTestDb();
    const worker = createEmployee(db, { displayName: "Игорь" });
    createShift(db, { date: DAY, start: "09:00", end: "18:00", category: "shift", title: "День", employeeId: worker.id });
    const evening = createShift(db, { date: DAY, start: "11:00", end: "20:00", category: "shift", title: "Вечер", employeeId: worker.id });

    expect(dayAfterLine(db, { employeeId: worker.id, date: DAY, keepSilentForEntryId: evening.id })).toBe(
      "Теперь на Ср 12 авг у тебя: 09:00–18:00 · День, 11:00–20:00 · Вечер.",
    );
  });

  it("осталась одна запись, и это та самая — молчит, письмо её уже назвало", () => {
    const db = makeTestDb();
    const worker = createEmployee(db, { displayName: "Игорь" });
    const only = createShift(db, { date: DAY, start: "09:00", end: "18:00", category: "shift", title: "День", employeeId: worker.id });

    expect(dayAfterLine(db, { employeeId: worker.id, date: DAY, keepSilentForEntryId: only.id })).toBeNull();
  });

  it("осталась одна, но другая — говорит, иначе человек не узнает, что у него теперь", () => {
    const db = makeTestDb();
    const worker = createEmployee(db, { displayName: "Игорь" });
    const staying = createShift(db, { date: DAY, start: "11:00", end: "20:00", category: "shift", title: "Вечер", employeeId: worker.id });

    // 9999 — id только что удалённой записи, её в базе уже нет.
    expect(dayAfterLine(db, { employeeId: worker.id, date: DAY, keepSilentForEntryId: 9999 })).toBe(
      "Теперь на Ср 12 авг у тебя: 11:00–20:00 · Вечер.",
    );
    expect(staying.id).not.toBe(9999);
  });

  it("день опустел — про это сказать надо", () => {
    const db = makeTestDb();
    const worker = createEmployee(db, { displayName: "Игорь" });

    expect(dayAfterLine(db, { employeeId: worker.id, date: DAY, keepSilentForEntryId: 9999 })).toBe(
      "Теперь на Ср 12 авг у тебя ничего.",
    );
  });

  it("чужие записи того же дня не считаются", () => {
    const db = makeTestDb();
    const worker = createEmployee(db, { displayName: "Игорь" });
    const other = createEmployee(db, { displayName: "Марк" });
    const mine = createShift(db, { date: DAY, start: "09:00", end: "18:00", category: "shift", title: "День", employeeId: worker.id });
    createShift(db, { date: DAY, start: "11:00", end: "20:00", category: "shift", title: "Вечер", employeeId: other.id });

    expect(dayAfterLine(db, { employeeId: worker.id, date: DAY, keepSilentForEntryId: mine.id })).toBeNull();
  });

  it("многодневное отсутствие, накрывающее день, считается", () => {
    const db = makeTestDb();
    const worker = createEmployee(db, { displayName: "Игорь" });
    createShift(db, { date: "2026-08-10", endDate: "2026-08-14", category: "vacation", employeeId: worker.id });
    const added = createShift(db, { date: DAY, start: "09:00", end: "18:00", category: "shift", title: "День", employeeId: worker.id });

    expect(dayAfterLine(db, { employeeId: worker.id, date: DAY, keepSilentForEntryId: added.id })).toBe(
      "Теперь на Ср 12 авг у тебя: весь день · Отпуск, 09:00–18:00 · День.",
    );
  });
});
```

Свериться перед написанием: точную сигнатуру `createShift` взять из
`server/src/repo/shifts.ts`, а не из этого плана — если поле называется иначе, прав файл.

- [ ] **Step 3: Прогнать — тест должен упасть**

Run: `npx vitest run server/src/schedule/day-summary.test.ts`
Expected: FAIL — `Failed to resolve import "./day-summary"`.

- [ ] **Step 4: Написать реализацию**

Создать `server/src/schedule/day-summary.ts`:

```ts
import { categoryLabel } from "@planer/shared";
import type { Db } from "../db/client";
import { listShiftsOverlapping } from "../repo/shifts";
import { dayLabel } from "../util/message-lines";

interface DayAfterOpts {
  employeeId: number;
  date: string;
  /**
   * The entry the letter already named. When it is the only thing left on that
   * day, this line would just repeat the sentence above it.
   */
  keepSilentForEntryId: number;
}

/**
 * «Теперь на Ср 12 авг у тебя: 09:00–18:00 · День, 11:00–20:00 · Вечер.»
 *
 * Существует ради случая, который стоил разбора: админ поставил вторую смену
 * рядом с уже стоявшей и снял первую только через двенадцать часов. Письмо о
 * второй смене говорило лишь про неё, и человек не мог узнать, что у него на
 * этот день теперь две пересекающиеся смены.
 *
 * `listShiftsOverlapping`, а не выборка по `date`: многодневное отсутствие,
 * начавшееся раньше, накрывает этот день и обязано попасть в список.
 */
export function dayAfterLine(db: Db, opts: DayAfterOpts): string | null {
  const mine = listShiftsOverlapping(db, opts.date, opts.date).filter(
    (entry) => entry.employeeId === opts.employeeId,
  );
  const onlyTheNamedOne = mine.length === 1 && mine[0]!.id === opts.keepSilentForEntryId;
  if (onlyTheNamedOne) return null;

  if (mine.length === 0) return `Теперь на ${dayLabel(opts.date)} у тебя ничего.`;

  const parts = mine
    .map((entry) => {
      const time = entry.start != null && entry.end != null ? `${entry.start}–${entry.end}` : "весь день";
      return `${time} · ${entry.title ?? categoryLabel(entry.category)}`;
    })
    .join(", ");
  return `Теперь на ${dayLabel(opts.date)} у тебя: ${parts}.`;
}
```

- [ ] **Step 5: Прогнать — тест должен пройти**

Run: `npx vitest run server/src/schedule/day-summary.test.ts`
Expected: PASS — шесть случаев.

- [ ] **Step 6: Проверить, что тест умеет падать**

Убрать ветку `onlyTheNamedOne` (пусть функция всегда возвращает строку) — краснеть
должны второй и пятый случаи. Вернуть.

- [ ] **Step 7: Приписать итог дня к одиночному письму**

Итог дня встраивается в **`notifyScheduleChange`**, а не в `notifyEntryChange`. Причина
не стилистическая: задача 5 переводит все три роута записи на буфер, буфер отправляет
через `notifyScheduleChange`, и код, встроенный в `notifyEntryChange`, после неё не
исполнялся бы ни разу. `notifyScheduleChange` при этом уже умеет одиночный текст —
`scheduleSummaryText` отдаёт его, когда у человека изменилась ровно одна запись.

В `change-notice.ts` рядом с `notifyScheduleChange`:

```ts
/**
 * Appends «what you have on that day now» when it says something new.
 *
 * Only for the one-entry letter: a summary of several changes already lists
 * them, and the same line under it would repeat itself. A multi-day entry is
 * summarised by its first day, the same day `entryLineOf` leads with.
 */
function withDayAfter(db: Db, diff: EmployeeDiff, text: string): string {
  const only = diff.added[0] ?? diff.removed[0] ?? diff.changed[0]?.after;
  const total = diff.added.length + diff.removed.length + diff.changed.length;
  if (total !== 1 || !only || only.employeeId == null) return text;
  const line = dayAfterLine(db, {
    employeeId: only.employeeId,
    date: only.date,
    keepSilentForEntryId: only.id,
  });
  return line ? `${text}\n${line}` : text;
}
```

И в теле `notifyScheduleChange` (строка 191) обернуть построенный текст:

```ts
    const text = withDayAfter(db, future, scheduleSummaryText(actorName, opts.cause, future));
```

Импорт в шапке файла дополнить: `dayAfterLine` из `./day-summary`.

Для удалённой записи `keepSilentForEntryId` — её собственный id, которого в базе уже
нет: условие «осталась одна и это она» не сработает, и человек получит честный остаток
дня.

`notifyEntryChange` пока не трогать — до задачи 5 её всё ещё зовут три роута, и её
поведение меняется только в части слов (задача 2). Удаляется она в задаче 5, когда
осиротеет.

- [ ] **Step 8: Гейт и коммит**

Run: `npm test && npm run typecheck && npm run lint`
Expected: PASS.

```bash
git add server/src/schedule server/src/util/message-lines.ts
git commit -m "feat(уведомления): письмо показывает, что осталось у человека на этот день"
```

---

## Задача 4: буфер писем

**Files:**
- Create: `server/src/schedule/notice-buffer.ts`, `server/src/schedule/notice-buffer.test.ts`
- Modify: `server/src/schedule/change-notice.ts` (причина `manual`)

**Interfaces:**
- Consumes: `notifyScheduleChange`, `diffSchedules`, `NotifyReach`.
- Produces: `createNoticeBuffer(deps): NoticeBuffer` с методами
  `register(opts): NotifyReach` и `flushNow(employeeId?): Promise<void>`.
  Её зовёт задача 5.

- [ ] **Step 1: Добавить причину `manual`**

В `change-notice.ts`:

```ts
export type ChangeCause = "file" | "distribute" | "fill_week" | "manual";

const CAUSE_LABEL: Record<ChangeCause, string | null> = {
  file: "загрузка файла",
  distribute: "распределение смен",
  fill_week: "заполнение недели",
  // A hand edit needs no explanation — «обновил(а) твой график (ручная правка)»
  // states the obvious. The other three name a machine that did the work.
  manual: null,
};
```

И в `scheduleSummaryText` подставлять скобки только когда метка есть:

```ts
  const why = CAUSE_LABEL[cause] ? ` (${CAUSE_LABEL[cause]})` : "";
  return `${actorName} обновил(а) твой график${why}: ${counts.join(", ")}.${shown}${rest}`;
```

- [ ] **Step 2: Написать падающий тест**

Создать `server/src/schedule/notice-buffer.test.ts`:

```ts
import { Bot } from "grammy";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount } from "../repo/employees";
import { createShift } from "../repo/shifts";
import type { Db } from "../db/client";
import { createNoticeBuffer } from "./notice-buffer";

const NOW = { date: "2026-08-01", time: "10:00" };
const WINDOW_MS = 20_000;

/** A bot whose `sendMessage` calls land in `sent` instead of hitting the network —
 *  same helper shape as `http/employees.test.ts`, reused rather than reinvented. */
function testBot() {
  const bot = new Bot("12345:tok");
  bot.botInfo = { id: 1, is_bot: true, first_name: "P", username: "p_bot",
    can_join_groups: false, can_read_all_group_messages: false,
    supports_inline_queries: false } as unknown as typeof bot.botInfo;
  const sent: { chat_id: number | string; text: string }[] = [];
  bot.api.config.use((_p, method, payload) => {
    if (method === "sendMessage") sent.push(payload as { chat_id: number | string; text: string });
    return { ok: true, result: {} } as never;
  });
  return { bot, sent };
}

function worker(db: Db, displayName: string, tgId: number | null) {
  const person = createEmployee(db, { displayName, inviteToken: `inv-${displayName}` });
  if (tgId != null) linkTelegramAccount(db, `inv-${displayName}`, tgId);
  return person;
}

const shiftOn = (db: Db, employeeId: number, date: string, title: string, start: string, end: string) =>
  createShift(db, { date, start, end, category: "shift", title, employeeId });

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("буфер писем о правке графика", () => {
  it("две правки внутри окна дают одно письмо", async () => {
    const db = makeTestDb();
    const admin = worker(db, "Аня", 111);
    const target = worker(db, "Игорь", 333);
    const { bot, sent } = testBot();
    const buffer = createNoticeBuffer({ db, bot, windowMs: WINDOW_MS });

    const first = shiftOn(db, target.id, "2026-08-11", "День", "09:00", "18:00");
    buffer.register({ actorEmployeeId: admin.id, before: null, after: first, now: NOW });
    await vi.advanceTimersByTimeAsync(WINDOW_MS / 2);
    const second = shiftOn(db, target.id, "2026-08-12", "День", "09:00", "18:00");
    buffer.register({ actorEmployeeId: admin.id, before: null, after: second, now: NOW });

    await vi.advanceTimersByTimeAsync(WINDOW_MS);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain("11 авг");
    expect(sent[0]!.text).toContain("12 авг");
  });

  it("две правки с разрывом больше окна дают два письма", async () => {
    const db = makeTestDb();
    const admin = worker(db, "Аня", 111);
    const target = worker(db, "Игорь", 333);
    const { bot, sent } = testBot();
    const buffer = createNoticeBuffer({ db, bot, windowMs: WINDOW_MS });

    const first = shiftOn(db, target.id, "2026-08-11", "День", "09:00", "18:00");
    buffer.register({ actorEmployeeId: admin.id, before: null, after: first, now: NOW });
    await vi.advanceTimersByTimeAsync(WINDOW_MS + 1);
    expect(sent).toHaveLength(1);

    const second = shiftOn(db, target.id, "2026-08-12", "День", "09:00", "18:00");
    buffer.register({ actorEmployeeId: admin.id, before: null, after: second, now: NOW });
    await vi.advanceTimersByTimeAsync(WINDOW_MS + 1);
    expect(sent).toHaveLength(2);
  });

  it("правка внутри окна сдвигает отправку", async () => {
    const db = makeTestDb();
    const admin = worker(db, "Аня", 111);
    const target = worker(db, "Игорь", 333);
    const { bot, sent } = testBot();
    const buffer = createNoticeBuffer({ db, bot, windowMs: WINDOW_MS });

    const first = shiftOn(db, target.id, "2026-08-11", "День", "09:00", "18:00");
    buffer.register({ actorEmployeeId: admin.id, before: null, after: first, now: NOW });
    // Ждём почти всё окно, потом правим ещё раз — отправка обязана отъехать.
    await vi.advanceTimersByTimeAsync(WINDOW_MS - 1_000);
    const second = shiftOn(db, target.id, "2026-08-12", "День", "09:00", "18:00");
    buffer.register({ actorEmployeeId: admin.id, before: null, after: second, now: NOW });

    await vi.advanceTimersByTimeAsync(2_000);
    expect(sent).toHaveLength(0); // старый срок уже прошёл бы — значит таймер сброшен
    await vi.advanceTimersByTimeAsync(WINDOW_MS);
    expect(sent).toHaveLength(1);
  });

  it("правки разным людям не смешиваются в одно письмо", async () => {
    const db = makeTestDb();
    const admin = worker(db, "Аня", 111);
    const igor = worker(db, "Игорь", 333);
    const mark = worker(db, "Марк", 444);
    const { bot, sent } = testBot();
    const buffer = createNoticeBuffer({ db, bot, windowMs: WINDOW_MS });

    const forIgor = shiftOn(db, igor.id, "2026-08-11", "День", "09:00", "18:00");
    const forMark = shiftOn(db, mark.id, "2026-08-11", "Вечер", "11:00", "20:00");
    buffer.register({ actorEmployeeId: admin.id, before: null, after: forIgor, now: NOW });
    buffer.register({ actorEmployeeId: admin.id, before: null, after: forMark, now: NOW });

    await vi.advanceTimersByTimeAsync(WINDOW_MS + 1);
    expect(sent).toHaveLength(2);
    const igorText = sent.find((m) => m.chat_id === 333)!.text;
    expect(igorText).toContain("День");
    expect(igorText).not.toContain("Вечер");
  });

  it("register отвечает предсказанием, не дожидаясь отправки", async () => {
    const db = makeTestDb();
    const admin = worker(db, "Аня", 111);
    const noTelegram = worker(db, "Марк", null);
    const { bot, sent } = testBot();
    const buffer = createNoticeBuffer({ db, bot, windowMs: WINDOW_MS });

    const entry = shiftOn(db, noTelegram.id, "2026-08-11", "День", "09:00", "18:00");
    const reach = buffer.register({ actorEmployeeId: admin.id, before: null, after: entry, now: NOW });

    // Ответ есть сразу, отправки ещё не было — в этом весь смысл предсказания.
    expect(reach).toEqual({ delivered: 0, intended: 1 });
    expect(sent).toHaveLength(0);
  });

  it("автору его же правка не пишется", async () => {
    const db = makeTestDb();
    const admin = worker(db, "Аня", 111);
    const { bot, sent } = testBot();
    const buffer = createNoticeBuffer({ db, bot, windowMs: WINDOW_MS });

    const own = shiftOn(db, admin.id, "2026-08-11", "День", "09:00", "18:00");
    const reach = buffer.register({ actorEmployeeId: admin.id, before: null, after: own, now: NOW });

    expect(reach).toEqual({ delivered: 0, intended: 0 });
    await vi.advanceTimersByTimeAsync(WINDOW_MS + 1);
    expect(sent).toHaveLength(0);
  });
});
```

Свериться перед написанием: `linkTelegramAccount` и `makeTestDb` — по фактическим
сигнатурам в `server/src/repo/employees.ts` и `server/src/db/testdb.ts`. Если поле
называется иначе, прав файл, а не план.

- [ ] **Step 3: Прогнать — тест должен упасть**

Run: `npx vitest run server/src/schedule/notice-buffer.test.ts`
Expected: FAIL — `Failed to resolve import "./notice-buffer"`.

- [ ] **Step 4: Написать буфер**

Создать `server/src/schedule/notice-buffer.ts`:

```ts
import type { Bot } from "grammy";
import type { Db } from "../db/client";
import type { Shift } from "../db/schema";
import { getEmployeeById } from "../repo/employees";
import { type NotifyReach, notifyScheduleChange } from "./change-notice";
import { type EmployeeDiff, diffSchedules } from "./schedule-diff";

/**
 * Twenty seconds, measured against the incident this exists for: an admin
 * cancelled one worker's holiday and typed a work week over it with 4-11
 * seconds between clicks, and the worker got five separate messages in 24
 * seconds. A pause longer than this window honestly earns a second letter.
 */
export const NOTICE_WINDOW_MS = 20_000;

interface Pending {
  diff: EmployeeDiff;
  actorEmployeeId: number;
  now: { date: string; time: string };
  timer: ReturnType<typeof setTimeout>;
}

export interface NoticeBufferDeps {
  db: Db;
  bot: Bot | undefined;
  windowMs?: number;
}

export interface RegisterOpts {
  actorEmployeeId: number;
  before: Shift | null;
  after: Shift | null;
  now: { date: string; time: string };
}

export interface NoticeBuffer {
  register(opts: RegisterOpts): NotifyReach;
  flushNow(): Promise<void>;
}

/**
 * Collects hand edits per worker and sends one letter instead of one per entry.
 *
 * In memory on purpose, the same call `rate-limit.ts` makes: one process, one
 * database, no second replica. The cost is named in the spec — an edit made in
 * the last twenty seconds before a restart never reaches its worker.
 *
 * Known limit, deliberately not solved: creating an entry and deleting it again
 * inside one window reports «+1, −1» rather than staying silent. Cancelling out
 * would mean comparing entries instead of events, and the case is rare.
 */
export function createNoticeBuffer(deps: NoticeBufferDeps): NoticeBuffer {
  const { db, bot } = deps;
  const windowMs = deps.windowMs ?? NOTICE_WINDOW_MS;
  const pending = new Map<number, Pending>();

  async function flush(employeeId: number): Promise<void> {
    const entry = pending.get(employeeId);
    if (!entry) return;
    pending.delete(employeeId);
    clearTimeout(entry.timer);
    await notifyScheduleChange(db, bot, {
      actorEmployeeId: entry.actorEmployeeId,
      diffs: new Map([[employeeId, entry.diff]]),
      cause: "manual",
      now: entry.now,
    });
  }

  function register(opts: RegisterOpts): NotifyReach {
    const perEmployee = diffSchedules(
      opts.before ? [opts.before] : [],
      opts.after ? [opts.after] : [],
    );
    let intended = 0;
    let delivered = 0;

    for (const [employeeId, incoming] of perEmployee) {
      if (employeeId === opts.actorEmployeeId) continue; // себе не пишем

      // The prediction the route answers with. `notifyScheduleChange` will
      // recount the same way when it actually sends; what it cannot know yet is
      // whether Telegram accepted the message.
      intended += 1;
      if (getEmployeeById(db, employeeId)?.telegramUserId != null) delivered += 1;

      const held = pending.get(employeeId);
      if (held) clearTimeout(held.timer);
      const diff: EmployeeDiff = held
        ? {
            added: [...held.diff.added, ...incoming.added],
            removed: [...held.diff.removed, ...incoming.removed],
            changed: [...held.diff.changed, ...incoming.changed],
          }
        : incoming;
      pending.set(employeeId, {
        diff,
        actorEmployeeId: opts.actorEmployeeId,
        now: opts.now,
        // A later edit for the same worker restarts the wait: the letter should
        // describe the state the admin stopped at, not the one they passed through.
        timer: setTimeout(() => void flush(employeeId), windowMs),
      });
    }
    return { delivered, intended };
  }

  /** Sends everything held right now. For tests and for a graceful shutdown. */
  async function flushNow(): Promise<void> {
    for (const employeeId of [...pending.keys()]) await flush(employeeId);
  }

  return { register, flushNow };
}
```

Два места, где легко ошибиться:

- `void flush(employeeId)` — `setTimeout` не умеет ждать промис, а бросать отсюда
  некому: отправка идёт после коммита правки, и упавший Telegram не должен ронять
  процесс. `notifyScheduleChange` внутри уже ничего не бросает.
- Автор правки пропускается **до** подсчёта `intended`. Иначе админ, правящий свою
  смену, увидел бы «уйдёт 0 из 1» про письмо, которого не будет.

- [ ] **Step 5: Прогнать тесты буфера**

Run: `npx vitest run server/src/schedule/notice-buffer.test.ts`
Expected: PASS — пять случаев.

- [ ] **Step 6: Проверить, что тесты умеют падать**

Убрать `clearTimeout` из `register` — краснеть должен случай «правка внутри окна
сдвигает отправку». Затем заменить ключ накопителя на константу — краснеть должен
случай «правки разным людям не смешиваются». Вернуть оба.

- [ ] **Step 7: Гейт и коммит**

Run: `npm test && npm run typecheck && npm run lint`
Expected: PASS.

```bash
git add server/src/schedule
git commit -m "feat(уведомления): буфер на 20 секунд — одно письмо вместо письма на запись"
```

---

## Задача 5: роуты и мини-апп

**Files:**
- Modify: `server/src/http/app.ts` (три роута записи)
- Modify: `miniapp/src/lib/shift.ts`, `miniapp/src/lib/shift.test.ts`
- Modify: `miniapp/src/screens/admin/AdminScheduleScreen.tsx:307-312`

**Interfaces:**
- Consumes: `createNoticeBuffer` (задача 4).
- Produces: ничего нового наружу; форма ответа роутов не меняется.

- [ ] **Step 1: Опорная точка**

Run: `npx vitest run server/src/http miniapp/src`
Expected: PASS. После правки набор должен остаться таким же зелёным.

- [ ] **Step 2: Завести буфер в приложении**

В `createApp` рядом с прочими зависимостями:

```ts
  // One buffer per app instance, not per request: it is the thing that holds
  // the timers. Tests build a fresh app and therefore a fresh buffer.
  const noticeBuffer = createNoticeBuffer({ db, bot });
```

Три роута (`POST /api/admin/entries`, `PATCH /api/admin/entries/:id`,
`DELETE /api/admin/entries/:id`) меняют `await notifyEntryChange(db, bot, {...})` на
`noticeBuffer.register({...})` — те же аргументы, но без `await`: предсказание
возвращается сразу.

`POST /api/admin/entries/bulk`, распределение и импорт **не трогать** — у них своя
сводка, и отправляют они внутри запроса.

После этой замены `notifyEntryChange` не зовётся ниоткуда — **удалить её вместе с
`EntryChangeOpts`**. Проверить командой, а не глазами:

```bash
grep -rn "notifyEntryChange" server/src miniapp/src admin/src
```

Ожидание: ни одного попадания вне удаляемых строк. Осиротевшая функция с живым тестом
рядом — это «тест-театр» через уровень косвенности: он зелёный всегда и не доказывает
ничего. Её тесты в `change-notice.test.ts` либо переводятся на `notifyScheduleChange`,
либо удаляются вместе с ней.

- [ ] **Step 3: Текст «уйдёт» вместо «дошло» для одиночных правок**

В `miniapp/src/lib/shift.ts` рядом с `notifyNotice`:

```ts
/**
 * То же самое, но про письмо, которое ещё не ушло.
 *
 * Одиночная правка копится в буфере сервера до двадцати секунд, поэтому в
 * момент ответа факта доставки нет — есть только знание, у кого из адресатов
 * привязан телеграм. Врать словом «дошло» об этом нельзя, а молчать не надо:
 * сообщение произносится ровно в том же случае, что и раньше — часть команды
 * не подключила телеграм.
 */
export function notifyPendingNotice(reach: { delivered: number; intended: number }): string | null {
  if (reach.intended === 0 || reach.delivered >= reach.intended) return null;
  return `Уведомление уйдёт ${reach.delivered} из ${reach.intended}: остальные не подключили телеграм.`;
}
```

`notifyNotice` **оставить как есть** — её продолжают звать импорт файла, «Распределить
честно» и «Заполнить неделю», а они отправляют внутри запроса и отчитываются о факте.

В `AdminScheduleScreen.tsx:312` заменить `notifyNotice(notified)` на
`notifyPendingNotice(notified)`. Строки 299 и 319 (распределение и заполнение недели)
**не трогать**.

- [ ] **Step 4: Тест на оба текста**

Дописать в `miniapp/src/lib/shift.test.ts`:

```ts
describe("текст про доставку уведомления", () => {
  it("про уже отправленное говорит «дошло»", () => {
    expect(notifyNotice({ delivered: 0, intended: 1 })).toBe(
      "Уведомление дошло до 0 из 1: остальные не подключили телеграм.",
    );
  });

  it("про ещё не отправленное говорит «уйдёт»", () => {
    expect(notifyPendingNotice({ delivered: 0, intended: 1 })).toBe(
      "Уведомление уйдёт 0 из 1: остальные не подключили телеграм.",
    );
  });

  it("оба молчат, когда сказать нечего", () => {
    for (const reach of [{ delivered: 1, intended: 1 }, { delivered: 0, intended: 0 }]) {
      expect(notifyNotice(reach)).toBeNull();
      expect(notifyPendingNotice(reach)).toBeNull();
    }
  });
});
```

- [ ] **Step 5: Прогнать и проверить падение**

Run: `npx vitest run miniapp/src/lib/shift.test.ts server/src/http`
Expected: PASS.

Затем в `notifyPendingNotice` вернуть слово «дошло до» — краснеть должен второй случай.
Вернуть «уйдёт».

- [ ] **Step 6: Гейт и коммит**

Run: `npm test && npm run typecheck && npm run lint && npm run build --workspace @planer/miniapp`
Expected: PASS всё четыре.

```bash
git add server/src/http miniapp/src
git commit -m "refactor(уведомления): одиночные правки идут через буфер, ответ стал предсказанием"
```

---

## Задача 6: живой случай целиком

Проверка не единицы, а сценария: ровно те действия, что случились 7 и 8 августа,
прогоняются через HTTP и дают то, что человек должен был прочитать.

**Files:**
- Modify: `server/src/http/entries.test.ts`

**Interfaces:**
- Consumes: всё построенное задачами 1-5.
- Produces: ничего.

- [ ] **Step 1: Написать сценарный тест**

Дописать в `server/src/http/entries.test.ts`. Шапка файла (`config`, `makeTestDb`,
`tokenFor`, `bearer`, `authedJson`, `testBot`) уже есть — переиспользовать её, а не
заводить свою.

```ts
describe("правка целой недели одним письмом", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("отмена отпуска и четыре смены подряд дают одно письмо, называющее отпуск отпуском", async () => {
    // Сценарий из живого журнала 7 августа: правка записи отпуска в смену, затем
    // четыре новых дня — всё внутри одного окна буфера. До этой работы человек
    // получал пять сообщений за 24 секунды, и первое звало его отпуск «сменой».
    const db = makeTestDb();
    const { bot, sent } = testBot();
    const target = worker(db, "Игорь", 333);
    const vacation = createShift(db, {
      date: "2026-08-10", endDate: "2026-08-14", category: "vacation", employeeId: target.id,
    });
    const app = createApp({ db, config, bot });
    const admin = await tokenFor(app, 111);

    await app.request(`/api/admin/entries/${vacation.id}`, authedJson(admin, {
      date: "2026-08-10", endDate: null, category: "shift", title: "День",
      start: "09:00", end: "18:00", employeeId: target.id,
    }, "PATCH"));
    for (const date of ["2026-08-11", "2026-08-12", "2026-08-13"]) {
      await app.request("/api/admin/entries", authedJson(admin, {
        date, category: "shift", title: "День", start: "09:00", end: "18:00", employeeId: target.id,
      }));
    }

    expect(sent).toHaveLength(0); // ещё копится — в этом весь смысл буфера
    await vi.advanceTimersByTimeAsync(NOTICE_WINDOW_MS + 1);

    expect(sent).toHaveLength(1);
    const text = sent[0]!.text;
    expect(text).toContain("отпуск");
    // Раньше здесь стояло «изменил(а) твою смену» про отпуск — ровно то, из-за чего
    // человек и написал. Никакая правка отпуска не смеет называться сменой.
    expect(text).not.toContain("твою смену");
  });

  it("вторая смена рядом с уже стоявшей называет обе в одном письме", async () => {
    // Сценарий 8 августа: на дне уже стоит «День 09:00–18:00», админ ставит рядом
    // «Вечер 11:00–20:00» и снимает первую только вечером. Письмо обязано сказать,
    // что смен на этот день стало две, — иначе человек узнает об этом через 12 часов.
    const db = makeTestDb();
    const { bot, sent } = testBot();
    const target = worker(db, "Игорь", 333);
    createShift(db, {
      date: "2026-08-12", start: "09:00", end: "18:00",
      category: "shift", title: "День", employeeId: target.id,
    });
    const app = createApp({ db, config, bot });
    const admin = await tokenFor(app, 111);

    await app.request("/api/admin/entries", authedJson(admin, {
      date: "2026-08-12", category: "shift", title: "Вечер",
      start: "11:00", end: "20:00", employeeId: target.id,
    }));
    await vi.advanceTimersByTimeAsync(NOTICE_WINDOW_MS + 1);

    expect(sent).toHaveLength(1);
    const text = sent[0]!.text;
    expect(text).toContain("Теперь на Ср 12 авг у тебя:");
    expect(text).toContain("09:00–18:00 · День");
    expect(text).toContain("11:00–20:00 · Вечер");
  });
});
```

Импорты файла дополнить: `vi`, `beforeEach`, `afterEach` из vitest и `NOTICE_WINDOW_MS`
из `../schedule/notice-buffer` — числом `20000` окно не писать, иначе тест разъедется с
константой при первой же её правке.

**Проверить оба на падение, и это здесь важнее обычного:**

- первый — временно вернуть роутам `notifyEntryChange` вместо `noticeBuffer.register`:
  `sent` станет четыре сообщения вместо одного;
- второй — временно убрать `withDayAfter` из `notifyEntryChange`: пропадёт строка
  «Теперь на Ср 12 авг у тебя:».

Если после любой из этих поломок тест остаётся зелёным — он проверяет не то, что назван,
и переписывать надо тест, а не реализацию.

- [ ] **Step 2: Прогнать**

Run: `npx vitest run server/src/http/entries.test.ts`
Expected: PASS.

- [ ] **Step 3: Полный гейт**

Run: `npm test && npm run typecheck && npm run lint`
Expected: PASS.

Run: `npm run build --workspace @planer/miniapp && npm run build --workspace @planer/admin`
Expected: обе сборки успешны.

- [ ] **Step 4: Коммит**

```bash
git add server/src/http
git commit -m "test(уведомления): живой случай 7-8 августа прогоняется целиком"
```

---

## Что этот план осознанно не делает

- **Не запрещает ничего.** Ни двойного бронирования, ни смены поверх отпуска. Решение
  владельца, процитировано в спеке.
- **Не трогает назначение на выходной слот** — там принято обратное решение, и оно
  объяснено комментарием на месте.
- **Не трогает импорт, распределение и «Заполнить неделю»** — у них сводка уже есть.
- **Не добавляет действия «заменить отпуск рабочими днями»** в интерфейс.
- **Не переносит буфер в базу.** Потеря писем при рестарте внутри окна принята как риск.

## Что проверить после исполнения

1. Сколько сообщений даёт сценарий 7 августа — должно быть одно.
2. Видно ли в письме про вторую смену, что смен на дне стало две.
3. Не начал ли `notifyNotice` врать где-то ещё: он остался у трёх массовых путей, и там
   слово «дошло» по-прежнему правда.
