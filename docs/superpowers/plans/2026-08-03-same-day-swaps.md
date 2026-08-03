# Обмен внутри одного дня и выбор человека — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** обмен сменами возможен только внутри одного дня, а на экране обмена человек ищет коллегу по имени, а не листает 93 чужие смены.

**Architecture:** правило «тот же день» добавляется в общий валидатор `validateSwap` — единственное место, через которое проходят оба входа (мини-апп и кнопка «Принять» в боте). Экран обмена получает чистую функцию `swapCandidates`, которая из расписания одного дня отбирает тех, с кем обмен реально пройдёт, и считает тех, кто в этот день на такой же смене. `App.tsx` грузит расписание за дату отдаваемой смены, а не за текущую неделю.

**Tech Stack:** TypeScript, React 18, `@telegram-apps/telegram-ui`, vitest (+ jsdom для экранных тестов), Hono + drizzle на сервере.

## Состояние (обновлять после каждой задачи)

| Задача | Статус | Коммит |
|---|---|---|
| 1. `different-day` в `validateSwap` | ✅ сделана | `b42e79f` |
| 2. `swapCandidates` — кто в списке | ✅ сделана | `3c2f814` |
| 3. Экран: поиск, строки дня, видимый выбор | ✅ сделана (вместе с 4) | `0bcf4d9` |
| 4. `App.tsx` грузит день под смену | ✅ сделана (вместе с 3) | `0bcf4d9` |
| 5. Живая проверка в Chromium и ledger | ✅ сделана | — |

Живая проверка нашла один дефект сверх плана: «· Выбрано» в `subtitle` резалось
многоточием на 390px. Починено переносом в проп `description` у `Cell` — см. ledger.

## Global Constraints

- Спека: `docs/superpowers/specs/2026-08-03-same-day-swaps-design.md`. Расхождение с ней — ошибка плана, не повод импровизировать.
- **Правило «тот же день» живёт ровно в одном месте** — в `validateSwap`. Не добавлять вторую проверку в роут `POST /api/swaps`, в `createSwap`/`acceptSwap` или в бота: второй источник правды рано или поздно разойдётся с первым.
- **Дежурства по-прежнему не обмениваются** (`isSwappable` не трогать).
- Экран не должен предлагать то, что сервер потом отклонит: условия отбора в `swapCandidates` — те же, что в валидаторе.
- Реальных ФИО в тестах, доках и моках быть не может — репозиторий публичный. Имена брать выдуманные; сторож `npx vitest run no-real-names`.
- Каждый коммит зелёный по полному гейту: `npm test && npm run typecheck && npm run build --workspace @planer/miniapp && npm run build --workspace @planer/admin`.
- Один дефект/шаг = один коммит.

## File Structure

| Файл | Ответственность |
|---|---|
| `shared/src/swap.ts` (M) | + причина `different-day` в `SwapRejectReason` и проверка в `validateSwap` |
| `shared/src/swap-validate.test.ts` (M) | тест правила + перевод фикстур на один день |
| `miniapp/src/lib/swap-candidates.ts` (C) | чистый отбор: кто в списке и сколько человек на такой же смене |
| `miniapp/src/lib/swap-candidates.test.ts` (C) | юниты отбора |
| `miniapp/src/screens/ProposeSwapScreen.tsx` (M) | поиск по имени, строки одного дня, видимый выбор, свёрнутая строка про «такую же смену» |
| `miniapp/src/screens/propose-swap.test.tsx` (C) | экранные тесты самого экрана (jsdom) |
| `miniapp/src/screens/propose-swap-day.test.tsx` (C) | экранный тест: приложение спрашивает расписание за день смены |
| `miniapp/src/App.tsx` (M) | загрузка расписания за дату отдаваемой смены |

---

### Task 1: правило «тот же день» в `validateSwap`

**Files:**
- Modify: `shared/src/swap.ts:22-29` (union причин), `shared/src/swap.ts:82-99` (сама проверка)
- Test: `shared/src/swap-validate.test.ts`

**Interfaces:**
- Consumes: ничего нового
- Produces: `SwapRejectReason` пополняется литералом `"different-day"`; `validateSwap` возвращает `{ ok: false, reason: "different-day" }`, когда `fromShift.date !== toShift.date`

- [ ] **Step 1: Написать падающий тест**

Добавить в `shared/src/swap-validate.test.ts` внутрь `describe("validateSwap")`:

```ts
  it("отказывает в обмене между разными днями", () => {
    const r = validateSwap({
      fromShift: from, toShift: shift({ id: 2, date: "2026-07-11", employeeId: 200 }),
      fromEmployeeId: 100, toEmployeeId: 200,
      fromOtherShifts: [], toOtherShifts: [], now,
    });
    expect(r).toEqual({ ok: false, reason: "different-day" });
  });

  it("день важнее прочих причин: кросс-дневный обмен называется днём, а не прошлым", () => {
    const r = validateSwap({
      fromShift: from, toShift: shift({ id: 2, date: "2026-06-01", employeeId: 200 }),
      fromEmployeeId: 100, toEmployeeId: 200,
      fromOtherShifts: [], toOtherShifts: [], now,
    });
    expect(r).toEqual({ ok: false, reason: "different-day" });
  });
```

- [ ] **Step 2: Прогнать, убедиться что падает**

Run: `npx vitest run swap-validate`
Expected: FAIL — оба новых теста получают `{ ok: true }` и `{ ok: false, reason: "to-shift-in-past" }`.

- [ ] **Step 3: Реализовать**

В `shared/src/swap.ts` добавить литерал первым в union:

```ts
export type SwapRejectReason =
  | "different-day"
  | "from-shift-not-owned"
  | "to-shift-not-owned"
  | "from-shift-in-past"
  | "to-shift-in-past"
  | "double-booking-from"
  | "double-booking-to"
  | "identical-shift";
```

И проверку в `validateSwap` — сразу после двух проверок владения, до проверок прошлого:

```ts
  if (fromShift.employeeId !== fromEmployeeId) return { ok: false, reason: "from-shift-not-owned" };
  if (toShift.employeeId !== toEmployeeId) return { ok: false, reason: "to-shift-not-owned" };

  // Обмен существует только внутри одного дня (его решение, 2026-08-03): отдаёшь
  // четверг — берёшь смену коллеги в этот же четверг. Стоит здесь, а не в экране,
  // потому что через этот валидатор проходят оба входа — предложение из мини-аппа
  // и кнопка «Принять» в боте, — и потому что до проверок «в прошлом» и «та же
  // самая смена»: человеку надо назвать ту причину, которая ближе к делу.
  if (fromShift.date !== toShift.date) return { ok: false, reason: "different-day" };
```

- [ ] **Step 4: Прогнать новый тест — зелено**

Run: `npx vitest run swap-validate`
Expected: новые два теста PASS. Часть старых тестов в этом же файле упадёт — их фикстуры кросс-дневные (`from` 2026-07-10, `to` 2026-07-11). Это ожидаемо и чинится следующим шагом.

- [ ] **Step 5: Перевести фикстуры на один день**

В `shared/src/swap-validate.test.ts` базовая пара становится однодневной, но не одинаковой по виду (иначе сработает `identical-shift`):

```ts
  const from = shift({ id: 1, date: "2026-07-10", start: "09:00", end: "18:00", employeeId: 100 });
  const to = shift({ id: 2, date: "2026-07-10", start: "19:00", end: "23:00", employeeId: 200 });
```

Дальше прогнать весь гейт и починить **каждый** упавший тест в остальных файлах — везде, где обмен строился на две разные даты:

```
server/src/swap/swap-service.test.ts   (пара sa/sb: 2026-07-10 и 2026-07-11)
server/src/http/swaps.test.ts
server/src/bot/bot.test.ts
server/src/http/app.test.ts
server/src/repo/swaps.test.ts
```

Правило починки: обе смены переносятся на **одну дату**, а различие переносится на время (например `08:00–17:00` против `19:00–23:00`), чтобы тест продолжал проверять то, что проверял. Если тест по смыслу был именно про разные дни — он становится тестом нового отказа `different-day`, а не удаляется.

Run: `npm test`
Expected: PASS целиком.

- [ ] **Step 6: Полный гейт и коммит**

```bash
npm test && npm run typecheck && npm run build --workspace @planer/miniapp && npm run build --workspace @planer/admin
git add shared/src/swap.ts shared/src/swap-validate.test.ts server/src miniapp/src
git commit -m "feat(swaps): меняться можно только внутри одного дня"
```

---

### Task 2: `swapCandidates` — кто попадает в список

**Files:**
- Create: `miniapp/src/lib/swap-candidates.ts`
- Test: `miniapp/src/lib/swap-candidates.test.ts`

**Interfaces:**
- Consumes: `Shift` из `../api/client`, `isIdenticalShift` из `@planer/shared`, `hasStarted` из `./swaps`
- Produces:
  ```ts
  export interface SwapCandidates { candidates: Shift[]; sameKindCount: number }
  export function swapCandidates(fromShift: Shift, dayShifts: readonly Shift[], meId: number, now: Date): SwapCandidates
  ```

- [ ] **Step 1: Написать падающий тест**

```ts
import { describe, expect, it } from "vitest";
import type { Shift } from "../api/client";
import { swapCandidates } from "./swap-candidates";

const DAY = "2026-09-10";
const NOW = new Date("2026-09-01T10:00:00");

const shift = (over: Partial<Shift> & { id: number }): Shift =>
  ({
    date: DAY, endDate: null, start: "09:00", end: "18:00", category: "shift",
    title: "День", templateId: 2, employeeId: 2, employeeName: "Коллега А", location: null,
    note: null, unrecognisedCode: null, ...over,
  }) as Shift;

const mine = shift({ id: 1, employeeId: 1, employeeName: undefined, start: "15:00", end: "23:00", templateId: 4, title: "Вечер" });

describe("swapCandidates", () => {
  it("берёт только чужие смены того же дня", () => {
    const other = shift({ id: 2 });
    const otherDay = shift({ id: 3, date: "2026-09-11" });
    const { candidates } = swapCandidates(mine, [mine, other, otherDay], 1, NOW);
    expect(candidates.map((s) => s.id)).toEqual([2]);
  });

  it("не предлагает вакантную запись — менять не с кем", () => {
    const vacant = shift({ id: 2, employeeId: null, employeeName: undefined });
    const { candidates } = swapCandidates(mine, [vacant], 1, NOW);
    expect(candidates).toEqual([]);
  });

  it("не предлагает дежурство, отпуск и клетку без времени", () => {
    const duty = shift({ id: 2, category: "duty", title: "Дежурство" });
    const vacation = shift({ id: 3, category: "vacation", start: null, end: null, employeeId: 3 });
    const unreadable = shift({ id: 4, start: null, end: null, templateId: null, employeeId: 4 });
    const { candidates } = swapCandidates(mine, [duty, vacation, unreadable], 1, NOW);
    expect(candidates).toEqual([]);
  });

  it("не предлагает начавшуюся смену", () => {
    const started = shift({ id: 2 });
    const { candidates } = swapCandidates(mine, [started], 1, new Date("2026-09-10T12:00:00"));
    expect(candidates).toEqual([]);
  });

  it("такую же смену прячет, но считает", () => {
    const same = shift({ id: 2, templateId: mine.templateId, start: "15:00", end: "23:00", title: "Вечер" });
    const same2 = shift({ id: 3, employeeId: 3, templateId: mine.templateId, start: "15:00", end: "23:00", title: "Вечер" });
    const different = shift({ id: 4, employeeId: 4 });
    const { candidates, sameKindCount } = swapCandidates(mine, [same, same2, different], 1, NOW);
    expect(candidates.map((s) => s.id)).toEqual([4]);
    expect(sameKindCount).toBe(2);
  });

  it("сортирует по имени — человека ищут глазами, а не по времени", () => {
    const b = shift({ id: 2, employeeId: 2, employeeName: "Яшин Пётр" });
    const a = shift({ id: 3, employeeId: 3, employeeName: "Волков Илья" });
    const { candidates } = swapCandidates(mine, [b, a], 1, NOW);
    expect(candidates.map((s) => s.employeeName)).toEqual(["Волков Илья", "Яшин Пётр"]);
  });
});
```

- [ ] **Step 2: Прогнать, убедиться что падает**

Run: `npx vitest run swap-candidates`
Expected: FAIL — модуля нет.

- [ ] **Step 3: Реализовать**

```ts
import { isIdenticalShift } from "@planer/shared";
import type { Shift } from "../api/client";
import { hasStarted } from "./swaps";

export interface SwapCandidates {
  /** С кем обмен реально пройдёт — те же условия, что проверяет сервер. */
  candidates: Shift[];
  /** Сколько человек в этот день работают ровно твою смену. */
  sameKindCount: number;
}

/**
 * Кого показать на экране обмена.
 *
 * Обмен возможен только внутри одного дня, поэтому день задан отдаваемой сменой,
 * а вопрос сводится к «кто ещё сегодня работает и с кем это что-то изменит».
 *
 * Тех, у кого в этот день ровно такая же смена, экран прячет — сервер всё равно
 * ответит `identical-shift`, — но их надо посчитать: человек ищет коллегу,
 * которого точно видел в графике на этот день, и молчаливое отсутствие читается
 * как «экран сломан».
 *
 * Сортировка по имени, а не по времени: на этом экране выбирают человека.
 */
export function swapCandidates(
  fromShift: Shift,
  dayShifts: readonly Shift[],
  meId: number,
  now: Date,
): SwapCandidates {
  const candidates: Shift[] = [];
  let sameKindCount = 0;

  for (const shift of dayShifts) {
    if (shift.date !== fromShift.date) continue;
    if (shift.employeeId == null || shift.employeeId === meId) continue;
    if (shift.category !== "shift") continue;
    if (shift.start == null || shift.end == null) continue;
    if (hasStarted(shift, now)) continue;
    if (isIdenticalShift(fromShift, shift)) {
      sameKindCount += 1;
      continue;
    }
    candidates.push(shift);
  }

  candidates.sort((a, b) => (a.employeeName ?? "").localeCompare(b.employeeName ?? "", "ru"));
  return { candidates, sameKindCount };
}
```

- [ ] **Step 4: Прогнать — зелено**

Run: `npx vitest run swap-candidates`
Expected: PASS (6 тестов)

- [ ] **Step 5: Полный гейт и коммит**

```bash
npm test && npm run typecheck && npm run build --workspace @planer/miniapp && npm run build --workspace @planer/admin
git add miniapp/src/lib/swap-candidates.ts miniapp/src/lib/swap-candidates.test.ts
git commit -m "feat(miniapp): отбор коллег для обмена — тот же день, без такой же смены"
```

---

### Task 3: экран — поиск по имени и видимый выбор

**Files:**
- Modify: `miniapp/src/screens/ProposeSwapScreen.tsx` целиком (пропсы, список, поиск, состояния)
- Test: `miniapp/src/screens/propose-swap.test.tsx`

**Interfaces:**
- Consumes: `SwapCandidates` (Task 2) — экран получает уже отобранное, сам не фильтрует по правилам обмена
- Produces:
  ```ts
  export interface ProposeSwapScreenProps {
    fromShift: Shift;
    candidates: Shift[];
    sameKindCount: number;
    loading: boolean;
    loadError: string | null;
    onCancel: () => void;
    onConfirm: (toShiftId: number, message: string) => Promise<void>;
  }
  ```

- [ ] **Step 1: Написать падающий тест**

Создать `miniapp/src/screens/propose-swap.test.tsx` (рецепт jsdom взят из `miniapp/src/screens/admin/shift-kinds-rotation.test.tsx`):

```tsx
// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import type { Shift } from "../api/client";
import { ProposeSwapScreen } from "./ProposeSwapScreen";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DAY = "2026-09-10";
const shift = (over: Partial<Shift> & { id: number }): Shift =>
  ({
    date: DAY, endDate: null, start: "09:00", end: "18:00", category: "shift",
    title: "День", templateId: 2, employeeId: 2, employeeName: "Волков Илья",
    location: null, note: null, unrecognisedCode: null, ...over,
  }) as Shift;

const MINE = shift({ id: 1, employeeId: 1, employeeName: undefined, start: "15:00", end: "23:00", templateId: 4, title: "Вечер" });
const CANDIDATES = [
  shift({ id: 2, employeeId: 2, employeeName: "Волков Илья" }),
  shift({ id: 3, employeeId: 3, employeeName: "Яшин Пётр", start: "08:00", end: "17:00", templateId: 1, title: "Утро" }),
];

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null;
  host = null;
});

async function mount(props: Partial<Parameters<typeof ProposeSwapScreen>[0]> = {}) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      createElement(AppRoot, null, createElement(ProposeSwapScreen, {
        fromShift: MINE, candidates: CANDIDATES, sameKindCount: 0,
        loading: false, loadError: null,
        onCancel: () => {}, onConfirm: async () => {}, ...props,
      })),
    );
  });
  return host;
}

function rowTexts(el: HTMLElement): string[] {
  return [...el.querySelectorAll("[data-testid='swap-candidate']")].map((n) => n.textContent ?? "");
}

describe("экран обмена", () => {
  it("показывает коллег того же дня с их временем", async () => {
    const el = await mount();
    const rows = rowTexts(el);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("Волков Илья");
    expect(rows[0]).toContain("09:00");
  });

  it("поиск по имени оставляет только совпавших", async () => {
    const el = await mount();
    const search = el.querySelector("input[type='search']") as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(search, "яш");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const rows = rowTexts(el);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain("Яшин Пётр");
  });

  it("выбор виден на самой строке, а не только на кнопке внизу", async () => {
    const el = await mount();
    const row = el.querySelectorAll("[data-testid='swap-candidate']")[0] as HTMLElement;
    await act(async () => row.click());
    expect(row.textContent).toContain("Выбрано");
  });

  it("говорит, сколько человек в этот день на такой же смене", async () => {
    const el = await mount({ sameKindCount: 12 });
    expect(el.textContent).toContain("Ещё 12 человек");
  });

  it("когда меняться не с кем — объясняет, а не молчит пустым списком", async () => {
    const el = await mount({ candidates: [], sameKindCount: 3 });
    expect(el.textContent).toContain("меняться не с кем");
    expect(rowTexts(el)).toEqual([]);
  });

  it("пока грузится — не врёт, что меняться не с кем", async () => {
    const el = await mount({ candidates: [], sameKindCount: 0, loading: true });
    expect(el.textContent).not.toContain("меняться не с кем");
  });
});
```

- [ ] **Step 2: Прогнать, убедиться что падает**

Run: `npx vitest run propose-swap`
Expected: FAIL — у экрана другие пропсы (`colleagueShifts`), нет ни поиска, ни `data-testid`.

- [ ] **Step 3: Реализовать экран**

`ProposeSwapScreen.tsx`: заменить интерфейс пропсов и тело списка. Ключевые куски (остальное — шапка, «Отдаёшь свою смену», разделитель, поле сообщения, кнопка — остаются как есть):

```tsx
export interface ProposeSwapScreenProps {
  /** The caller's own shift being offered up — opened from its "Обменять" affordance. */
  fromShift: Shift;
  /** Colleagues working the SAME day, already filtered to those a swap can succeed with. */
  candidates: Shift[];
  /** How many people work exactly this shift that day — hidden from the list, but named. */
  sameKindCount: number;
  loading: boolean;
  loadError: string | null;
  onCancel: () => void;
  onConfirm: (toShiftId: number, message: string) => Promise<void>;
}
```

Внутри компонента — поиск и отфильтрованный список:

```tsx
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? candidates.filter((s) => (s.employeeName ?? "").toLowerCase().includes(needle))
    : candidates;
```

Секция со списком:

```tsx
      <List>
        <Section header="Кто ещё работает в этот день">
          {candidates.length > 3 && (
            <div style={{ padding: "2px 12px 8px" }}>
              <Input type="search" placeholder="Поиск по имени" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
          )}
          {loading ? (
            <div style={{ display: "flex", justifyContent: "center", padding: 16 }}><Spinner size="m" /></div>
          ) : loadError ? (
            <Placeholder description={loadError} />
          ) : candidates.length === 0 ? (
            <Placeholder description={emptyText(sameKindCount)} />
          ) : shown.length === 0 ? (
            <Placeholder description="Никого с таким именем в этот день нет." />
          ) : (
            shown.map((shift) => {
              const name = shift.employeeName ?? "Без имени";
              const palette = personPalette(shift.employeeId);
              const selected = selectedId === shift.id;
              return (
                <Cell
                  key={shift.id}
                  data-testid="swap-candidate"
                  before={<Avatar acronym={initialsOf(name)} size={40} style={{ background: palette.bg, color: palette.fg }} />}
                  subtitle={`${formatTimeRange(shift)} · ${shift.title ?? categoryLabel(shift.category)}${selected ? " · Выбрано" : ""}`}
                  after={<Selectable type="radio" name="colleague-shift" checked={selected} onChange={() => setSelectedId(shift.id)} />}
                  onClick={() => setSelectedId(shift.id)}
                >
                  {name}
                </Cell>
              );
            })
          )}
          {!loading && !loadError && sameKindCount > 0 && candidates.length > 0 && (
            <div style={{ padding: "6px 16px 12px", color: "var(--tgui--hint_color)", fontSize: 13 }}>
              Ещё {sameKindCount} {pluralizeRu(sameKindCount, "человек", "человека", "человек")} в этот день на такой же
              смене — с ними обмен ничего не изменит.
            </div>
          )}
        </Section>
      </List>
```

Пустой текст — своим хелпером рядом с компонентом:

```tsx
/** Пусто бывает по двум разным причинам, и человеку важно, по какой именно. */
function emptyText(sameKindCount: number): string {
  return sameKindCount > 0
    ? "В этот день все остальные на такой же смене — меняться не с кем."
    : "В этот день больше никто не работает — меняться не с кем.";
}
```

Если `Cell` из telegram-ui не пробрасывает `data-testid` в DOM — обернуть строку в `<div data-testid="swap-candidate">…</div>` и оставить `Cell` внутри. Тест проверяет поведение, а не то, на каком узле висит атрибут.

Плюс к `SWAP_ERROR_MESSAGES` добавить причину нового отказа:

```ts
  "different-day": "Меняться можно только сменами в один и тот же день.",
```

И к импортам: `Input`, `Spinner` из `@telegram-apps/telegram-ui`, `pluralizeRu` из `../lib/shift`.

- [ ] **Step 4: Прогнать — зелено**

Run: `npx vitest run propose-swap`
Expected: PASS (6 тестов)

- [ ] **Step 5: Полный гейт и коммит**

Гейт на этом шаге упадёт на `App.tsx` — он передаёт старые пропсы. Это чинит Task 4, поэтому здесь коммитить экран **вместе** с правкой `App.tsx` нельзя, а гейт зелёным не будет. Порядок такой: доделать Task 4 и коммитить обе задачи одним коммитом.

```bash
# после Task 4:
npm test && npm run typecheck && npm run build --workspace @planer/miniapp && npm run build --workspace @planer/admin
git add miniapp/src/screens/ProposeSwapScreen.tsx miniapp/src/screens/propose-swap.test.tsx miniapp/src/App.tsx
git commit -m "feat(miniapp): обмен — ищешь человека, а не листаешь 93 чужие смены"
```

---

### Task 4: `App.tsx` грузит день под отдаваемую смену

**Files:**
- Modify: `miniapp/src/App.tsx:211-230` (ветка `proposingFor`) + новое состояние и эффект рядом с остальными

**Interfaces:**
- Consumes: `swapCandidates` (Task 2), новые пропсы `ProposeSwapScreen` (Task 3), `apiClient.getTeamSchedule`
- Produces: ничего для следующих задач

- [ ] **Step 1: Написать падающий тест**

Экранный тест на то, что при открытии обмена запрашивается **один день**, а не неделя. Создать `miniapp/src/screens/propose-swap-day.test.tsx` (подмена клиента — `vi.spyOn`, ровно как в `miniapp/src/screens/worker-action-error.test.tsx`):

```tsx
// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { apiClient, type Shift } from "../api/client";
import { App } from "../App";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Смена на три недели вперёд — недельная выборка про неё ничего не знает. */
const FAR_AWAY = "2026-09-25";
const MY_SHIFT = {
  id: 4242, date: FAR_AWAY, endDate: null, start: "15:00", end: "23:00",
  category: "shift", title: "Вечер", templateId: 4, employeeId: 1,
  location: null, note: null, unrecognisedCode: null,
} as unknown as Shift;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
const asked: { from: string; to: string }[] = [];

beforeEach(() => {
  asked.length = 0;
  vi.spyOn(apiClient, "getMyShifts").mockResolvedValue([MY_SHIFT]);
  vi.spyOn(apiClient, "getTeamSchedule").mockImplementation(async (from: string, to: string) => {
    asked.push({ from, to });
    return { employees: [], shifts: [] };
  });
  vi.spyOn(apiClient, "getSwaps").mockResolvedValue([]);
  vi.spyOn(apiClient, "getWeekendSlots").mockResolvedValue([]);
  vi.spyOn(apiClient, "getWeekendOffers").mockResolvedValue([]);
});

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.restoreAllMocks();
});

async function settle(times = 30) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
  }
}

async function mount() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(AppRoot, null, createElement(App)));
  });
  await settle();
  return host;
}

describe("загрузка дня под отдаваемую смену", () => {
  it("спрашивает расписание за дату смены, а не за текущую неделю", async () => {
    const el = await mount();
    const swap = [...el.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === "Обменять");
    expect(swap).toBeDefined();
    await act(async () => swap!.click());
    await settle();
    expect(asked.at(-1)).toEqual({ from: FAR_AWAY, to: FAR_AWAY });
  });
});
```

- [ ] **Step 2: Прогнать, убедиться что падает**

Run: `npx vitest run propose-swap`
Expected: FAIL — сейчас `getTeamSchedule` зовётся только на загрузке приложения, с понедельника по воскресенье.

- [ ] **Step 3: Реализовать**

Рядом с остальными `useState` в `App.tsx`:

```tsx
  // Расписание за день отдаваемой смены. Грузится отдельно от недельного:
  // «Обменять» доступно и на смене через три недели, а недельная выборка про неё
  // ничего не знает — раньше в этом случае экран показывал пустой список.
  const [dayShifts, setDayShifts] = useState<{ date: string; shifts: Shift[] } | null>(null);
  const [dayLoading, setDayLoading] = useState(false);
  const [dayError, setDayError] = useState<string | null>(null);
```

Эффект:

```tsx
  useEffect(() => {
    if (!proposingFor) {
      setDayShifts(null);
      setDayError(null);
      return;
    }
    let cancelled = false;
    const date = proposingFor.date;
    setDayLoading(true);
    setDayError(null);
    apiClient
      .getTeamSchedule(date, date)
      .then((schedule) => {
        if (!cancelled) setDayShifts({ date, shifts: schedule.shifts });
      })
      .catch((err: unknown) => {
        console.error("Day schedule failed:", err);
        if (!cancelled) setDayError("Не удалось загрузить, кто работает в этот день.");
      })
      .finally(() => {
        if (!cancelled) setDayLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [proposingFor]);
```

Ветка рендера вместо нынешнего фильтра по `data.teamShifts`:

```tsx
  if (proposingFor) {
    // День берём только свой: пока грузится другой, старые строки показывать нельзя —
    // это чужой день, и человек предложит обмен не туда.
    const day = dayShifts?.date === proposingFor.date ? dayShifts.shifts : [];
    const { candidates, sameKindCount } = swapCandidates(proposingFor, day, data.me.id, new Date());
    return (
      <ProposeSwapScreen
        fromShift={proposingFor}
        candidates={candidates}
        sameKindCount={sameKindCount}
        loading={dayLoading}
        loadError={dayError}
        onCancel={() => setProposingFor(null)}
        onConfirm={handleConfirmSwap}
      />
    );
  }
```

Импорты: добавить `swapCandidates` из `./lib/swap-candidates`; убрать ставшие лишними `isIdenticalShift` и `hasStarted`, если `tsc` скажет, что они больше не используются.

- [ ] **Step 4: Прогнать — зелено**

Run: `npx vitest run propose-swap`
Expected: PASS

- [ ] **Step 5: Полный гейт и коммит**

Коммит общий с Task 3 — команда в Task 3, Step 5.

---

### Task 5: живая проверка и ledger

**Files:**
- Modify: `docs/audit/ledger.md`, `docs/superpowers/plans/2026-08-03-same-day-swaps.md` (таблица «Состояние»)

- [ ] **Step 1: Полный гейт**

```bash
npm test && npm run typecheck && npm run build --workspace @planer/miniapp && npm run build --workspace @planer/admin
npx vitest run no-real-names
```

- [ ] **Step 2: Живая проверка в Chromium на DEV-моке**

Playwright в проект не установлен — ставить в скрачпад и запускать с `executablePath` на ревизию 1228 (рецепт — в `deploy-state`, раздел про Playwright). Проверить руками три вещи:

1. «Обменять» на своей смене → в списке **только люди того же дня**, у каждого видно время.
2. Поиск по имени фильтрует список.
3. Тап по строке → на самой строке появляется «Выбрано», не только на кнопке внизу.

- [ ] **Step 3: Записать в ledger**

В `docs/audit/ledger.md` — раздел про находку от него живьём 2026-08-03 («полная каша в обменах»): что было замерено (93 строки, нет даты у чужой смены, чужой график на неделю против своего на месяц), что стало, и что правило «тот же день» теперь стоит в валидаторе.

- [ ] **Step 4: Коммит**

```bash
git add docs/audit/ledger.md docs/superpowers/plans/2026-08-03-same-day-swaps.md
git commit -m "docs(audit): обмены — тот же день и выбор человека, что замерено и что стало"
```

## Проверка после всех задач

- [ ] Полный гейт зелёный.
- [ ] `npx vitest run no-real-names` — сторож приватности зелёный.
- [ ] Кросс-дневный обмен невозможен ни из мини-аппа, ни кнопкой в боте — оба входа идут через `validateSwap`.
- [ ] После пуша: `gh run list` — CI зелёный, и число файлов тестов не упало.
