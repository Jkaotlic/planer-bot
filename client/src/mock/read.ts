import type {
  MyShiftsResponse,
  ScheduleEntryDto,
  TeamScheduleResponse,
  TemplateDto,
} from "@planer/shared";
import { delay } from "./delay";

/**
 * Что моку домена read нужно знать про работника.
 *
 * `rosterOrder` здесь нет намеренно: он вычисляется как позиция среди активных,
 * ровно как это делает сервер и как делал мок мини-аппа до переезда.
 */
export interface ReadMockEmployee {
  id: number;
  displayName: string;
  isActive: boolean;
  excludedFromSwaps: boolean;
}

/**
 * Состояние мока — параметр, а не собственность пакета.
 *
 * Причина не стилистическая: записи графика мутируют домены, которые ещё не
 * переехали (создание и правка смены, распределение, импорт ростера), и экраны
 * админки рассчитывают, что правка сразу видна в графике без перезагрузки. Пока
 * те домены живут во фронте, состояние принадлежит фронту, а пакет владеет
 * только формой ответа и чтением. Переедет `entries` — переедет и состояние.
 */
export interface ReadMockState {
  templates: readonly TemplateDto[];
  entries: readonly ScheduleEntryDto[];
  employees: readonly ReadMockEmployee[];
  /** Чьи смены считаются «своими» в `getMyShifts`. */
  meId: number;
}

export interface ReadMockOptions {
  delayMs: number;
  state?: ReadMockState;
}

const todayIso = (): string => new Date().toISOString().slice(0, 10);

const endOf = (s: ScheduleEntryDto): string => s.endDate ?? s.date;

const overlapsRange = (s: ScheduleEntryDto, from: string, to: string): boolean =>
  s.date <= to && endOf(s) >= from;

const byDateThenStart = (a: ScheduleEntryDto, b: ScheduleEntryDto): number =>
  a.date.localeCompare(b.date) || (a.start ?? "").localeCompare(b.start ?? "");

/**
 * Проекция в чистый DTO.
 *
 * Состояние приходит из фронта и несёт лишнее: мини-апп держит в записи
 * `employeeName`, который приклеивает сам, а сервер такого поля не отдаёт.
 * Мок, отдающий его, разошёлся бы с сервером ровно там, где контракт и должен
 * ловить расхождение, — поэтому поля перечислены, а не спреднуты.
 */
const toEntry = (s: ScheduleEntryDto): ScheduleEntryDto => ({
  id: s.id,
  date: s.date,
  start: s.start,
  end: s.end,
  endDate: s.endDate,
  category: s.category,
  title: s.title,
  location: s.location,
  unrecognisedCode: s.unrecognisedCode,
  templateId: s.templateId,
  employeeId: s.employeeId,
});

export function createReadMock(opts: ReadMockOptions) {
  const { delayMs } = opts;
  const state = opts.state ?? seedReadMockState();

  return {
    async getTemplates(): Promise<TemplateDto[]> {
      await delay(delayMs);
      return state.templates.map((t) => ({ ...t }));
    },

    async getMyShifts(): Promise<MyShiftsResponse> {
      await delay(delayMs);
      const today = todayIso();
      return {
        shifts: state.entries
          .filter((s) => s.employeeId === state.meId && endOf(s) >= today)
          .sort(byDateThenStart)
          .map(toEntry),
        today,
      };
    },

    async getTeamSchedule(from: string, to: string): Promise<TeamScheduleResponse> {
      await delay(delayMs);
      const active = state.employees.filter((e) => e.isActive);
      return {
        employees: active.map((employee, rosterOrder) => ({
          id: employee.id,
          displayName: employee.displayName,
          rosterOrder,
          excludedFromSwaps: employee.excludedFromSwaps,
        })),
        shifts: state.entries
          .filter((entry) => overlapsRange(entry, from, to))
          .sort(byDateThenStart)
          .map(toEntry),
      };
    },
  };
}

/** Понедельник текущей недели — чтобы экраны в dev не устаревали к следующему месяцу. */
function mondayOfThisWeek(): Date {
  const d = new Date();
  const shift = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - shift);
  d.setHours(12, 0, 0, 0);
  return d;
}

/** ISO-дата «понедельник + смещение». */
function dayIso(offsetFromMonday: number): string {
  const d = mondayOfThisWeek();
  d.setDate(d.getDate() + offsetFromMonday);
  return d.toISOString().slice(0, 10);
}

/**
 * Сид по умолчанию: неделя на трёх работниках.
 *
 * Он нужен, чтобы мок был запускаем и проверяем сам по себе, без фронта. Фронт,
 * у которого своё состояние, передаёт его через `state` и этот сид не трогает.
 * Имена вымышлены — репозиторий публичный.
 */
export function seedReadMockState(): ReadMockState {
  const templates: TemplateDto[] = [
    {
      id: 1,
      name: "Утро",
      category: "shift",
      start: "08:00",
      end: "17:00",
      fridayStart: "08:00",
      fridayEnd: "16:00",
      location: null,
      accent: "yellow",
      isLate: false,
      sendReminder: true,
      sortOrder: 0,
    },
    {
      id: 2,
      name: "День",
      category: "shift",
      start: "09:00",
      end: "18:00",
      fridayStart: "09:00",
      fridayEnd: "17:00",
      location: null,
      accent: "blue",
      isLate: false,
      sendReminder: true,
      sortOrder: 1,
    },
    {
      id: 3,
      name: "Дежурство · Поклонка",
      category: "duty",
      start: "09:00",
      end: "18:00",
      fridayStart: null,
      fridayEnd: null,
      location: "Поклонка",
      accent: "green",
      isLate: false,
      sendReminder: false,
      sortOrder: 2,
    },
  ];

  const employees: ReadMockEmployee[] = [
    { id: 1, displayName: "Аня", isActive: true, excludedFromSwaps: false },
    { id: 2, displayName: "Игорь", isActive: true, excludedFromSwaps: false },
    { id: 3, displayName: "Марк", isActive: true, excludedFromSwaps: true },
  ];

  let nextId = 1;
  const entry = (draft: Omit<ScheduleEntryDto, "id">): ScheduleEntryDto => ({
    id: nextId++,
    ...draft,
  });
  const shift = (
    date: string,
    templateId: number,
    title: string,
    start: string,
    end: string,
    employeeId: number,
  ): ScheduleEntryDto =>
    entry({
      date,
      start,
      end,
      endDate: null,
      category: "shift",
      title,
      location: null,
      unrecognisedCode: null,
      templateId,
      employeeId,
    });

  const entries: ScheduleEntryDto[] = [
    shift(dayIso(0), 1, "Утро", "08:00", "17:00", 1),
    shift(dayIso(0), 2, "День", "09:00", "18:00", 2),
    shift(dayIso(1), 1, "Утро", "08:00", "17:00", 3),
    shift(dayIso(1), 2, "День", "09:00", "18:00", 1),
    shift(dayIso(2), 2, "День", "09:00", "18:00", 2),
    entry({
      date: dayIso(2),
      start: "09:00",
      end: "18:00",
      endDate: null,
      category: "duty",
      title: "Дежурство · Поклонка",
      location: "Поклонка",
      unrecognisedCode: null,
      templateId: 3,
      employeeId: 3,
    }),
    // Отпуск: многодневная запись без часов — проверяет ветку `endDate`.
    entry({
      date: dayIso(3),
      start: null,
      end: null,
      endDate: dayIso(5),
      category: "vacation",
      title: null,
      location: null,
      unrecognisedCode: null,
      templateId: null,
      employeeId: 2,
    }),
    // Непрочитанный код из импорта — единственный случай с `unrecognisedCode`.
    entry({
      date: dayIso(4),
      start: null,
      end: null,
      endDate: null,
      category: "shift",
      title: null,
      location: null,
      unrecognisedCode: "Ко",
      templateId: null,
      employeeId: 1,
    }),
    // Ничья смена: сервер отдаёт её с `employeeId: null`.
    entry({
      date: dayIso(4),
      start: "09:00",
      end: "18:00",
      endDate: null,
      category: "shift",
      title: "День",
      location: null,
      unrecognisedCode: null,
      templateId: 2,
      employeeId: null,
    }),
    // Смена «меня» в воскресенье. Она здесь не для полноты картины: без записи
    // на последнем дне недели `getMyShifts` в субботу и воскресенье возвращал бы
    // пустой список, и тест на него зависел бы от дня, в который его запустили.
    shift(dayIso(6), 1, "Утро", "08:00", "17:00", 1),
  ];

  return { templates, entries, employees, meId: 1 };
}
