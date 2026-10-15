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
 * Что может завести себе наблюдатель.
 *
 * Отдельное множество, а не третий элемент в `SELF_WRITABLE`: то отвечает на
 * вопрос «что работник ставит себе сам», и ответ на него по-прежнему «ровно
 * два». Смена здесь появляется не потому, что стала самозаписываемой вообще,
 * а потому, что у наблюдателя её больше некому поставить — в раздаче его нет.
 */
const OBSERVER_SELF_WRITABLE: ReadonlySet<EntryCategory> = new Set([...SELF_WRITABLE, "shift"]);

/**
 * Всё, что админ может завести себе: семь из семи.
 *
 * Его правило от 2026-10-15 — «админы в любом случае могут менять любому что и
 * когда захотят», себе тоже. Граница «что работник ставит себе сам» существует
 * потому, что график ведёт админ; у того, кто его ведёт, отбирать нечего.
 * Множество строится из схемы, а не набирается руками: восьмая категория
 * попадёт сюда сама, а не останется «той, что админ себе почему-то не ставит».
 */
const ADMIN_SELF_WRITABLE: ReadonlySet<EntryCategory> = new Set(entryCategorySchema.options);

export interface SelfEntryAccess {
  /** `canAddOwnShifts` вызывающей стороны. */
  ownShifts?: boolean;
  /**
   * Вызывающий — админ. Только из проверенной роли: на сервере `isAdmin` из
   * базы, в мини-аппе — из «кто я». Никогда не из тела запроса — флаг снимает
   * все ограничения ниже, кроме правил самой записи (`entry-schema.ts`).
   */
  admin?: boolean;
}

function writableFor(access: SelfEntryAccess): ReadonlySet<EntryCategory> {
  if (access.admin) return ADMIN_SELF_WRITABLE;
  return access.ownShifts ? OBSERVER_SELF_WRITABLE : SELF_WRITABLE;
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
export function selfEntryRefusal(draft: SelfEntryDraft, today: string, access: SelfEntryAccess = {}): string | null {
  if (!writableFor(access).has(draft.category)) return "Такую запись ставит админ";
  // Сроки ниже — граница «сообщаю факт» против «переписываю историю», и её
  // держат ради админа, который видит последствия. Админу, правящему себя,
  // спрашивать некого. Предел длины записи (366 дней) остаётся — он в
  // `entryRangeError` и про целостность данных, а не про права.
  if (access.admin) return null;

  const offset = dayNumber(draft.date) - dayNumber(today);
  // Задним числом — только больничный: он сообщает о факте, который уже
  // случился. Смена и мероприятие — это план, и «поставить себе вчерашнюю
  // смену» переписывает отчётность, а не планирует.
  const earliest = draft.category === "sick_leave" ? -SICK_BACKDATE_DAYS : 0;
  if (offset < earliest) {
    if (draft.category === "sick_leave") {
      return `Больничный можно поставить не раньше чем за ${SICK_BACKDATE_DAYS} дней до сегодня — если нужно раньше, попроси админа`;
    }
    return draft.category === "shift"
      ? "Смену можно поставить на сегодня или вперёд"
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
  access: SelfEntryAccess = {},
): string | null {
  if (!writableFor(access).has(entry.category)) return "Такую запись правит админ";
  // Кончившаяся запись — отчётность, и трогать её должен админ. Он и трогает.
  if (access.admin) return null;
  if ((entry.endDate ?? entry.date) < today) return "Запись уже кончилась — если что-то не так, напиши админу";
  return null;
}
