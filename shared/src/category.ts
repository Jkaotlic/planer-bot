import { z } from "zod";

export const entryCategorySchema = z.enum([
  "shift",
  "vacation",
  "sick_leave",
  "duty",
  "offsite",
  "business_trip",
  "weekend_work",
]);
export type EntryCategory = z.infer<typeof entryCategorySchema>;

const ABSENCES: ReadonlySet<EntryCategory> = new Set(["vacation", "sick_leave", "business_trip"]);
const BALANCE_COUNTED: ReadonlySet<EntryCategory> = new Set([
  "shift",
  "duty",
  "offsite",
  "weekend_work",
]);

/**
 * Named colour slots a preset can claim, so different shifts (Утро/День/Вечер/…)
 * read apart at a glance in the schedule instead of all sharing the category's
 * one blue. Only the *name* is shared — each app maps it to its own light/dark
 * values, since legibility is a per-theme concern.
 */
export const templateAccents = ["gold", "blue", "violet", "indigo", "teal", "green", "rose", "amber", "emerald"] as const;
export type TemplateAccent = (typeof templateAccents)[number];

/**
 * Чем работники могут меняться между собой: обычные смены и дежурства
 * (его решение от 2026-08-10).
 *
 * Множество — рантайм-значение, а не только объединение типов, по той же
 * причине, что `SWAP_REJECT_REASONS` и `AUDIT_TYPES`: тест на полноту может
 * перебрать все категории и проверить, что обменных ровно две, вместо сверки
 * двух списков, набранных руками в разных файлах.
 *
 * ЕДИНСТВЕННОЕ место, где живёт это знание. Мини-апп зовёт эту же функцию — и в
 * списке кандидатов, и на кнопке «Обменять»: экран, прячущий кнопку там, где
 * сервер обмен разрешает, — наблюдаемый дефект, а не расхождение вкусов. Пул
 * дежурства при этом ничего не запрещает, он остаётся правилом автораздачи.
 */
const SWAPPABLE: ReadonlySet<EntryCategory> = new Set(["shift", "duty"]);

export function isSwappable(category: EntryCategory): boolean {
  return SWAPPABLE.has(category);
}

/** Absences (vacation, sick leave, business trip) — the worker is away, no times. */
export function isAbsence(category: EntryCategory): boolean {
  return ABSENCES.has(category);
}

/**
 * Клетка ростера, которую импорт не смог прочитать («Ко» и подобное) — своя
 * колонка в балансе и в отчёте.
 *
 * Это настоящая работа неизвестного вида: в `total` она идёт, как любая смена, но
 * ни под именем пресета (это значило бы «мы знаем, что там было»), ни в бакете
 * «Своё время» (это значит «часы поставили руками», а тут не так).
 *
 * Одна константа на все четыре читателя — сервер (раздача и отчёт) и обе консоли.
 * Раньше строка была объявлена в каждом из них, а рядом стояло «keep this in sync»:
 * разъехались бы молча, и тогда одна и та же запись читалась бы «День» в балансе и
 * «не распознано» в отчёте.
 */
export const UNRECOGNISED_KIND = "Не распознано (?)";

/** Categories that count toward the fair-distribution balance (work, not absences). */
export function countsForBalance(category: EntryCategory): boolean {
  return BALANCE_COUNTED.has(category);
}

/**
 * Русская подпись категории.
 *
 * Живёт здесь, потому что её просит сервер: письмо об изменении графика
 * называет вид записи словами, и человек должен прочитать в чате ровно то, что
 * увидит в клетке — там подпись это `title ?? categoryLabel(category)`.
 *
 * У мини-аппа есть своя копия этой таблицы (`miniapp/src/categories.tsx`), и
 * сейчас обе живут одновременно. Не потому, что мини-апп независим от shared:
 * он импортирует shared в рантайме в доброй половине своих экранов и утилит, а
 * с этой ветки ещё и зовёт `categoryLabel` через `toEntryView` для подписи
 * каждой записи. Копию держит в согласии с этой таблицей сторож
 * `miniapp/src/category-labels.test.ts`; объединять таблицы или нет —
 * отдельное решение, которое пока не принято.
 */
const CATEGORY_LABELS: Record<EntryCategory, string> = {
  shift: "Смена",
  vacation: "Отпуск",
  sick_leave: "Больничный",
  duty: "Дежурство",
  // «Мероприятие», а не «Выездное мероприятие»: выездное отличается заполненным
  // `location`, и это поле, а не категория. Категория, отличающаяся от соседней
  // только наличием строчки текста, — это поле.
  offsite: "Мероприятие",
  business_trip: "Командировка",
  weekend_work: "Работа в выходной",
};

export function categoryLabel(category: EntryCategory): string {
  return CATEGORY_LABELS[category];
}

/**
 * Категория в винительном падеже: «поставил(а) тебе смену», «снял(а) с тебя отпуск».
 *
 * Отдельной таблицей, а не падежом от `CATEGORY_LABELS`: «Работа в выходной» →
 * «работу в выходной» никаким правилом не выводится, а семь строк дешевле любого
 * правила и читаются глазами.
 *
 * Повод завести это: до 2026-08-11 все три письма о правке графика говорили
 * «смену» независимо от того, что правили, и человек прочитал «изменил твою
 * смену» про свой отпуск — понять из этого, отменён ли отпуск, было нельзя.
 */
const CATEGORY_ACCUSATIVE: Record<EntryCategory, string> = {
  shift: "смену",
  vacation: "отпуск",
  sick_leave: "больничный",
  duty: "дежурство",
  offsite: "мероприятие",
  business_trip: "командировку",
  weekend_work: "работу в выходной",
};

/** Та же форма с «твой/твоя/твоё»: род у категорий разный, и склеить его правилом нельзя. */
const CATEGORY_POSSESSIVE: Record<EntryCategory, string> = {
  shift: "твою смену",
  vacation: "твой отпуск",
  sick_leave: "твой больничный",
  duty: "твоё дежурство",
  offsite: "твоё мероприятие",
  business_trip: "твою командировку",
  weekend_work: "твою работу в выходной",
};

export function categoryAccusative(category: EntryCategory): string {
  return CATEGORY_ACCUSATIVE[category];
}

export function categoryPossessive(category: EntryCategory): string {
  return CATEGORY_POSSESSIVE[category];
}
