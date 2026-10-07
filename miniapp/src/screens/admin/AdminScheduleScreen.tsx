import { ConfirmButton } from "../../components/ConfirmButton";
import { useTelegramBack } from "../../lib/telegram-back";
import { useEffect, useMemo, useRef, useState } from "react";
import { Avatar, Cell, Input, Spinner } from "@telegram-apps/telegram-ui";
import { PersonPicker } from "../../components/PersonPicker";
import {
  ABSENCE_CATEGORIES,
  coverageHint,
  calendarFrom,
  dayOfWeek,
  dayOffLabel,
  isDayOff,
  missingCoverageUnlessAcked,
  CUSTOM_TIME_CATEGORIES,
  describeEntryRangePlan,
  describeEntryRangeResult,
  entryRangeHint,
  isAbsence,
  planEntryRange,
  resolveShiftTimes,
  takesPartInAssignment,
  shortfallStatus,
  specialDayKind,
  specialDays,
  weekShortfall,
  workPresets,
} from "@planer/shared";
import {
  apiClient,
  type Employee,
  type NewEntryInput,
  type Shift,
  type TeamSchedule,
  type Template,
  type TemplateRolesView,
} from "../../api/client";
import type { DayCalendar, EntryRangeMode } from "@planer/shared";
import { categoryLabel, useEntryPalette, type Category } from "../../categories";
import { BackToTodayButton } from "../../components/BackToTodayButton";
import { ActionButton, Card, CheckRow, Group, Hint, MenuRow, SelectField, ShortfallBanner, SpecialDaysLine } from "../../ui";
import { AdminRosterCsv } from "./AdminRosterCsv";
import { AdminShiftKinds } from "./AdminShiftKinds";
import { AdminKindSettings } from "./AdminKindSettings";
import { formatTimeRange, notifyPendingNotice, withNotifyNotice } from "../../lib/shift";
import { initialsOf, personPalette } from "../../lib/people";
import { useIsDark } from "../../lib/theme";
import { createLatestRequestGate } from "../../lib/request-gate";
import { mixOr } from "../../lib/color-mix";
import {
  addDays,
  dayOfMonth,
  formatDayLabel,
  formatWeekRangeLabel,
  isCurrentPeriod,
  mondayOf,
  parseISODate,
  toISODate,
  weekdayIndex,
  weekdayShort,
} from "../../lib/week";

/** Categories a new entry can be created with, in the order the form offers them. */
const ORDERED_CATEGORIES: readonly Category[] = ["shift", "vacation", "sick_leave", "duty", "offsite", "business_trip", "weekend_work"];

const FRIDAY_INDEX = 4;

/** Categories that carry explicit clock times (a single-day worked entry). */
function needsTime(category: Category): boolean {
  return category === "shift" || category === "duty" || category === "offsite" || category === "weekend_work";
}

/**
 * Whether the week bar + day strip should be visible. Hidden — rather than
 * merely disabled — for every sub-flow whose own state is seeded from the
 * visible week and never re-syncs afterwards: `EntryForm`'s `date`/`endDate`
 * (seeded once from `defaultDate`/`weekDates`) and `FillWeekPanel`'s `byDay`
 * (keyed once off `weekDates`) would both go stale — pointing at a day that
 * silently stopped being an option — if the admin navigated weeks while
 * either was open. The desktop console prevents the same class of bug with a
 * full-screen overlay that blocks the week switcher entirely; this is the
 * inline equivalent, reusing the pattern this screen already applies to the
 * CSV import and «кто что может» flows.
 */
export function showsWeekSwitcher(state: {
  csvOpen: boolean;
  kindsOpen: boolean;
  settingsOpen: boolean;
  fillOpen: boolean;
  editing: unknown;
}): boolean {
  return !state.csvOpen && !state.kindsOpen && !state.settingsOpen && !state.fillOpen && state.editing === null;
}

/**
 * "Расписание" (admin, mobile): a day-at-a-time editor. Pick a day from the
 * week strip, see everyone working it, tap an entry to edit or delete it, add
 * new entries, and fill a whole week for one person. The desktop's
 * week grid doesn't fit a phone, so this is rebuilt day-first from the same
 * data + entry rules (`AddEntryPanel`).
 */
export function AdminScheduleScreen({ initialDate, today, onScheduleChanged, nearestShortfall = null, onFormOpenChange }: {
  initialDate?: string;
  today: string;
  /** Первый день нехватки из сегодня…+6 (тот же ответ, что у метки на вкладке «Админ»). */
  nearestShortfall?: string | null;
  /** Правка графика меняет нехватку, а метка на вкладке «Админ» живёт выше, в App. */
  onScheduleChanged?: () => void;
  /** Открыта ли панель с вводом (запись, «Заполнить неделю», CSV): раздел выше по
   *  этому флагу переспрашивает «‹ Разделы», а не стирает набранное. */
  onFormOpenChange?: (open: boolean) => void;
}) {
  // Кнопка «📅 Открыть график» у админской тревоги приходит с датой — экран
  // должен открыться на её неделе, а не на текущей. Без неё — командная дата
  // сервера (`today`), не часы телефона: рядом с полуночью они расходятся, и
  // «Эта неделя»/день по умолчанию раньше вели туда, где, по мнению телефона,
  // сейчас сегодня, а не туда, где сейчас команда.
  const [weekStart, setWeekStart] = useState<Date>(() => mondayOf(parseISODate(initialDate ?? today)));
  const [selectedDate, setSelectedDate] = useState<string>(() => initialDate ?? today);
  const [shifts, setShifts] = useState<Shift[] | null>(null);
  /**
   * Понедельник недели, к которой относятся `shifts`. При листании записи прежней
   * недели остаются в состоянии до ответа сервера; посчитанные против дат новой,
   * они дают «никого нет», и закрытая неделя на время запроса открывалась бы
   * красной. Нехватка считается только по записям показанной недели.
   */
  const [shiftsFrom, setShiftsFrom] = useState<string | null>(null);
  // Праздники и рабочие субботы недели — из того же ответа, что и расписание.
  const [calendar, setCalendar] = useState<TeamSchedule["calendar"]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  /** Нормы дня по видам смен — из них считается подсказка «чего не хватает». */
  const [templateRoles, setTemplateRoles] = useState<TemplateRolesView[]>([]);
  // Пока нормы не пришли, пустой список ролей читается как «норм нет»: плашка
  // на секунду объявила бы «Нормы не заданы» там, где они заданы.
  const [rolesLoaded, setRolesLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Отказ загрузки людей, видов и норм — отдельно от `error`: у него есть
  // «Повторить», а без норм нет и плашки нехватки, так что красный текст без
  // кнопки оставлял экран без неё до перезахода в приложение.
  const [baseError, setBaseError] = useState<string | null>(null);
  /**
   * Отдельно от `error`, потому что это беда одной секции, а не экрана. Неделя,
   * которая не загрузилась, обязана сказать это на месте дня: иначе она либо
   * выдаёт день за пустой (`shifts` остались от прежней недели, ни одна запись
   * не совпадает с новым днём), либо крутит спиннер вечно (`loadWeek` снимает
   * записи первой строкой). Тот же довод, что в консоли — `admin/src/App.tsx`.
   */
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** null = closed, "new" = add form, a Shift = editing that entry. */
  const [editing, setEditing] = useState<Shift | "new" | null>(null);
  /** When true, the day view is replaced by the "Заполнить неделю" bulk-fill flow. */
  const [fillOpen, setFillOpen] = useState(false);
  /** When true, the day view is replaced by the CSV upload/download flow. */
  const [csvOpen, setCsvOpen] = useState(false);
  /** When true, the day view is replaced by the «кто что может» editor. */
  const [kindsOpen, setKindsOpen] = useState(false);
  /** When true, the day view is replaced by the «виды смен» editor. */
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Системная «Назад» из вложенной панели закрывает ПАНЕЛЬ (как её «Назад к
  // расписанию» / «Отмена»), а не раздел целиком: стек обработчиков отдаёт её
  // последней зарегистрированной, пока панель открыта.
  const panelOpen = fillOpen || csvOpen || kindsOpen || settingsOpen || editing !== null;
  useTelegramBack(closePanel, panelOpen);
  // Панели с набранным вводом: уйти из раздела, не дописав, значит потерять их.
  const formOpen = fillOpen || csvOpen || editing !== null;
  useEffect(() => {
    onFormOpenChange?.(formOpen);
    return () => onFormOpenChange?.(false);
  }, [formOpen]);

  const weekDates = useMemo(() => Array.from({ length: 7 }, (_, i) => toISODate(addDays(weekStart, i))), [weekStart]);
  const from = weekDates[0]!;
  const to = weekDates[6]!;

  // «📅 Заполнить неделю» и импорт файла держат в замыкании ту неделю, на
  // которой начались, и, будучи асинхронными, могут доработать уже после того,
  // как админ ушёл на другую неделю. Without this, whichever fetch resolves
  // last wins outright — possibly the stale one — and the header can end up
  // showing week N+1 while the list still shows week N. Same idea as
  // `team-schedule.ts`'s gate: every fetch that ends in `setShifts` registers
  // a ticket first and only applies its result while still holding the
  // newest one.
  const gate = useRef(createLatestRequestGate());

  /** Отказ не пробрасывается: зовущие («Сохранить», «Заполнить неделю», импорт)
   *  своё дело уже сделали, и провалившееся перечитывание
   *  не повод говорить им, что не удалось сохранить. Оно докладывает о себе само —
   *  на месте дня, с кнопкой «Повторить». */
  async function loadWeek(fromIso: string, toIso: string) {
    const id = gate.current.begin();
    setShifts(null);
    setScheduleError(null);
    try {
      const schedule = await apiClient.getTeamSchedule(fromIso, toIso);
      if (gate.current.isLatest(id)) {
        setShifts(schedule.shifts);
        setShiftsFrom(fromIso);
        setCalendar(schedule.calendar);
      }
    } catch (err) {
      if (gate.current.isLatest(id)) setScheduleError(err instanceof Error ? err.message : "Не удалось загрузить расписание");
    }
  }

  /** Закрыть открытую панель — то же, что её собственная кнопка «назад». */
  function closePanel() {
    if (fillOpen) setFillOpen(false);
    else if (kindsOpen) setKindsOpen(false);
    else if (settingsOpen) closeSettings();
    else if (csvOpen) setCsvOpen(false);
    else setEditing(null);
  }

  function closeSettings() {
    setSettingsOpen(false);
    // Норму правят там, а считают по ней здесь: без перечитывания
    // полоска показывала бы нехватку по нормам, какими они были при
    // открытии экрана. Не сумели — остаются прежние.
    apiClient.getTemplateRoles().then(setTemplateRoles, () => {});
    // И метка на вкладке «Админ»: сервер считает её по тем же нормам.
    onScheduleChanged?.();
  }

  /** A CSV import renames and creates people and rewrites entries, so both the
   *  roster and the visible week have to come back from the server. */
  async function reloadAfterImport() {
    const [emps] = await Promise.all([apiClient.getAdminEmployees(), loadWeek(from, to)]);
    setEmployees(emps.filter((e) => e.isActive));
    // Импорт переписывает записи недели — метка на вкладке считает по ним же.
    onScheduleChanged?.();
  }

  // Ключ перечитывания людей, видов и норм: «Повторить» после отказа.
  const [baseReload, setBaseReload] = useState(0);
  // Roster + templates load once; they don't change with the visible week.
  useEffect(() => {
    let cancelled = false;
    setBaseError(null);
    Promise.all([apiClient.getAdminEmployees(), apiClient.getTemplates(), apiClient.getTemplateRoles()])
      .then(([emps, tmpls, roles]) => {
        if (cancelled) return;
        setEmployees(emps.filter((e) => e.isActive));
        setTemplates(tmpls);
        setTemplateRoles(roles);
        setRolesLoaded(true);
      })
      .catch((err: unknown) => {
        if (!cancelled) setBaseError(err instanceof Error ? err.message : "Не удалось загрузить данные");
      });
    return () => {
      cancelled = true;
    };
  }, [baseReload]);

  // Schedule reloads whenever the visible week changes. Registers with the same
  // gate as `loadWeek` — navigating here must supersede a still-running
  // «Заполнить неделю» from the week just left, exactly
  // as a second navigation here already supersedes (via `cancelled`) a first.
  useEffect(() => {
    let cancelled = false;
    const id = gate.current.begin();
    apiClient
      .getTeamSchedule(from, to)
      .then((schedule) => {
        if (cancelled || !gate.current.isLatest(id)) return;
        setShifts(schedule.shifts);
        setShiftsFrom(from);
        // Календарь берётся из того же ответа, что и записи: иначе неделя,
        // прочитанная этим путём, красилась бы по календарю прежней.
        setCalendar(schedule.calendar);
        setScheduleError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // Записи прежней недели снимаем: выбранный день уже другой, ни одна из них
        // с ним не совпадёт, и экран сказал бы «в этот день ничего не запланировано»
        // про день, который просто не прочитали.
        setShifts(null);
        setScheduleError(err instanceof Error ? err.message : "Не удалось загрузить расписание");
      });
    return () => {
      cancelled = true;
    };
  }, [from, to]);

  // Отмеченные «Знаю про дату» дни показанной недели: бейдж и совет бота их уже не считают, и
  // плашка с метками не вправе краснеть по дате, о которой админы сказали «знаем». Ключ — начало
  // недели, как у `shiftsFrom`: пока ответ другой недели, меток нет, а не чужие. Ошибка чтения —
  // «отметок нет»: лишняя красная метка лучше, чем экран без нехватки.
  const [acks, setAcks] = useState<{ from: string; dates: string[] } | null>(null);
  useEffect(() => {
    let cancelled = false;
    apiClient
      .getCoverageAcks(from, to)
      .then((res) => { if (!cancelled) setAcks({ from, dates: res?.dates ?? [] }); })
      .catch(() => { if (!cancelled) setAcks({ from, dates: [] }); });
    return () => { cancelled = true; };
  }, [from, to]);
  const ackedDates = useMemo(() => new Set(acks && acks.from === from ? acks.dates : []), [acks, from]);

  function goWeek(deltaWeeks: number) {
    const nextStart = addDays(weekStart, deltaWeeks * 7);
    setWeekStart(nextStart);
    setSelectedDate(toISODate(addDays(nextStart, weekdayIndex(selectedDate))));
    setNotice(null);
  }

  /** К дыре за пределами показанной недели: неделя её дня и сам день — как при
   *  переходе по ссылке бота (`initialDate`). */
  function goToDate(date: string) {
    setWeekStart(mondayOf(parseISODate(date)));
    setSelectedDate(date);
    setNotice(null);
  }

  /** Back to the current week AND to today. Returning to the week but leaving the
   *  selection on, say, Thursday would drop the admin on a day they never picked. */
  function goToday() {
    setWeekStart(mondayOf(parseISODate(today)));
    setSelectedDate(today);
    setNotice(null);
  }

  // Праздники видимой недели: приезжают вместе с расписанием (см. `loadWeek`).
  const dayCalendar = useMemo(() => calendarFrom(calendar), [calendar]);

  const selectedDayRow = calendar.find((day) => day.date === selectedDate);
  // Подпись выходного и его происхождение: ручную отметку можно снять, а
  // пришедшую из календаря — только перекрыть своей.
  const dayOffText = dayOffLabel(selectedDate, selectedDayRow?.kind, selectedDayRow?.note ?? null);
  const [dayOffBusy, setDayOffBusy] = useState(false);

  async function markDay(kind: "holiday" | "workday" | null) {
    setDayOffBusy(true);
    try {
      await apiClient.setCalendarDay(selectedDate, kind);
      await loadWeek(from, to);
      onScheduleChanged?.();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Не удалось отметить день");
    } finally {
      setDayOffBusy(false);
    }
  }

  const weekShifts = shifts && shiftsFrom === from ? shifts : null;
  // Только по записям показанной недели; пока их нет — подсказка молчит, а не
  // объявляет нехватку по пустому списку.
  const dayHint = weekShifts && rolesLoaded ? coverageHint(missingCoverageUnlessAcked(weekShifts, templateRoles, selectedDate, dayCalendar, ackedDates)) : null;

  // Пока неделя грузится, меток нет: пустой список на секунду покрасил бы все
  // семь дней красным, и закрытая неделя открывалась бы тревогой.
  const week = useMemo(
    () => (weekShifts && rolesLoaded && acks?.from === from ? weekShortfall(weekShifts, templateRoles, weekDates, dayCalendar, ackedDates) : null),
    [weekShifts, rolesLoaded, templateRoles, weekDates, dayCalendar, ackedDates, acks, from],
  );
  const shortByDate = new Map(week?.days.map((day) => [day.date, day.short]));
  const status = week ? shortfallStatus(week, templateRoles) : null;

  const dayEntries = (weekShifts ?? [])
    .filter((s) => s.date <= selectedDate && (s.endDate ?? s.date) >= selectedDate)
    .sort((a, b) => (a.start ?? "").localeCompare(b.start ?? ""));

  async function handleSaved(notified: { delivered: number; intended: number }, summary?: string) {
    setEditing(null);
    await loadWeek(from, to);
    onScheduleChanged?.();
    // У одиночной записи своего сообщения об успехе нет — «дошло не до всех»
    // говорим, только когда есть что сказать, иначе экран молчит, как раньше.
    // У расстановки диапазоном есть: часть дней могла быть пропущена, и молчание
    // читалось бы как «встало всё».
    setNotice(summary ? withNotifyNotice(summary, notified) : notifyPendingNotice(notified));
  }

  async function handleFilled(count: number, notified: { delivered: number; intended: number }) {
    setFillOpen(false);
    await loadWeek(from, to);
    onScheduleChanged?.();
    const base = count === 0 ? "Ни одного дня не выбрано — ничего не добавлено." : `Заполнено дней: ${count}.`;
    setNotice(count === 0 ? base : withNotifyNotice(base, notified));
  }

  return (
    <>
      {/* The week switcher and day strip drive the day view, the entry form and the
          bulk fill. The CSV screen works on whole months from the file itself, so
          leaving them up there would offer navigation that changes nothing. Hidden
          (not just disabled) for the entry form and the bulk fill too — both seed
          their own state from the visible week once and never re-sync, so letting
          the admin navigate under them would leave that state pointing at a day
          that quietly isn't an option on screen anymore. */}
      {showsWeekSwitcher({ csvOpen, kindsOpen, settingsOpen, fillOpen, editing }) && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {week && status && (
            <ShortfallBanner
              week={week}
              status={status}
              onPickDay={(date) => { setSelectedDate(date); setNotice(null); }}
              onOpenNorms={() => { setNotice(null); setError(null); setSettingsOpen(true); }}
              nearestOutside={nearestShortfall && !weekDates.includes(nearestShortfall) ? nearestShortfall : null}
              onJumpNearest={goToDate}
            />
          )}
          <WeekBar
            label={formatWeekRangeLabel(weekStart, addDays(weekStart, 6))}
            backVisible={!isCurrentPeriod("week", toISODate(weekStart), today)}
            onBack={goToday}
            onPrev={() => goWeek(-1)}
            onNext={() => goWeek(1)}
          />
          <DayStrip dates={weekDates} selected={selectedDate} today={today} short={shortByDate} calendar={dayCalendar} onSelect={(d) => { setSelectedDate(d); setNotice(null); }} />
          <SpecialDaysLine days={specialDays(weekDates, calendar)} />
        </div>
      )}

      {error && <div style={{ color: "var(--tgui--destructive_text_color)", fontSize: "var(--app-text-body)" }}>{error}</div>}
      {baseError && (
        <Card>
          <span style={{ color: "var(--tgui--destructive_text_color)", fontSize: "var(--app-text-body)" }}>{baseError}</span>
          <ActionButton compact stretched onClick={() => setBaseReload((n) => n + 1)}>
            Повторить
          </ActionButton>
        </Card>
      )}
      {notice && <Hint>{notice}</Hint>}

      {fillOpen ? (
        <Group header="Заполнить неделю">
          <FillWeekPanel
            calendar={dayCalendar}
            employees={employees}
            templates={templates}
            weekDates={weekDates}
            onCancel={() => setFillOpen(false)}
            onFilled={handleFilled}
          />
        </Group>
      ) : kindsOpen ? (
        <AdminShiftKinds employees={employees} onClose={() => setKindsOpen(false)} />
      ) : settingsOpen ? (
        <AdminKindSettings onClose={closeSettings} />
      ) : csvOpen ? (
        <AdminRosterCsv
          employees={employees}
          today={selectedDate}
          onError={setError}
          onNotice={(message) => {
            setNotice(message);
            setCsvOpen(false);
          }}
          onImported={reloadAfterImport}
          onClose={() => setCsvOpen(false)}
        />
      ) : editing !== null ? (
        <Group header={editing === "new" ? "Новая запись" : "Изменить запись"}>
          <EntryForm
            employees={employees}
            templates={templates}
            existing={editing === "new" ? null : editing}
            defaultDate={selectedDate}
            calendar={dayCalendar}
            onCancel={() => setEditing(null)}
            onSaved={handleSaved}
          />
        </Group>
      ) : (
        <>
          <Group header={formatDayLabel(selectedDate)}>
            {scheduleError ? (
              <Card>
                <span style={{ color: "var(--tgui--destructive_text_color)", fontSize: "var(--app-text-body)" }}>{scheduleError}</span>
                <ActionButton compact stretched onClick={() => void loadWeek(from, to)}>
                  Повторить
                </ActionButton>
              </Card>
            ) : weekShifts === null ? (
              // Не `shifts === null`: при листании `shifts` ещё хранит прежнюю неделю,
              // а день уже новый — без этой проверки экран писал бы «ничего не
              // запланировано» про день, ответ про который ещё в пути.
              <Card>
                <div style={{ display: "flex", justifyContent: "center", padding: 12 }}>
                  <Spinner size="m" />
                </div>
              </Card>
            ) : (
              <>
                {/* Над подсказкой о норме: сперва «какой это день», потом
                    «чего в нём не хватает». Кнопки рядом, потому что решение
                    принимают, глядя на день, а не в настройках. Подсказка
                    стоит НАД записями: она про то, чего в дне нет, и под
                    списком её пришлось бы искать глазами. Молчит, пока норма
                    не задана — см. `missingCoverage`. */}
                <Card>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    {dayOffText && (
                      <span style={{ color: "var(--tgui--hint_color)", fontSize: "var(--app-text-meta)", lineHeight: 1.4 }}>
                        {dayOffText}
                        {selectedDayRow?.source === "manual" ? " (вручную)" : ""}
                      </span>
                    )}
                    <ActionButton compact disabled={dayOffBusy} onClick={() => void markDay(isDayOff(selectedDate, dayCalendar) ? "workday" : "holiday")}>
                      {isDayOff(selectedDate, dayCalendar) ? "Сделать рабочим" : "Сделать выходным"}
                    </ActionButton>
                    {selectedDayRow?.source === "manual" && (
                      <ActionButton compact kind="quiet" disabled={dayOffBusy} onClick={() => void markDay(null)}>
                        Как в календаре
                      </ActionButton>
                    )}
                  </div>
                  {dayHint && (
                    <div
                      role="status"
                      style={{ color: "var(--tgui--hint_color)", fontSize: "var(--app-text-meta)", lineHeight: 1.4 }}
                    >
                      {dayHint}
                    </div>
                  )}
                </Card>
                {dayEntries.length === 0 ? (
                  <Card>
                    <Hint>В этот день пока ничего не запланировано.</Hint>
                  </Card>
                ) : (
                  <Card flush>
                    {dayEntries.map((s) => <EntryRow key={s.id} shift={s} templates={templates} onTap={() => setEditing(s)} />)}
                  </Card>
                )}
              </>
            )}
            {/* По важности: одно главное («Добавить»), одно частое («Заполнить
                неделю»); остальное — редкие настройки и обмен файлом, их место
                в «Ещё», чтобы пять равных кнопок не спорили за внимание. */}
            <ActionButton kind="primary" stretched onClick={() => setEditing("new")}>
              ＋ Добавить
            </ActionButton>
            <ActionButton stretched onClick={() => setFillOpen(true)}>
              📅 Заполнить неделю
            </ActionButton>
          </Group>
          <Group header="Ещё">
            <Card flush>
              <MenuRow icon="📄" title="График файлом (CSV)" onClick={() => { setNotice(null); setError(null); setCsvOpen(true); }} />
              <MenuRow icon="⚙" title="Кто что может" onClick={() => { setNotice(null); setError(null); setKindsOpen(true); }} />
              <MenuRow icon="🗂" title="Виды смен" onClick={() => { setNotice(null); setError(null); setSettingsOpen(true); }} />
            </Card>
          </Group>
        </>
      )}
    </>
  );
}

function WeekBar({ label, backVisible, onBack, onPrev, onNext }: {
  label: string;
  /** False when the shown week already contains today. */
  backVisible: boolean;
  onBack: () => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
      <ActionButton onClick={onPrev} aria-label="Прошлая неделя">
        ‹
      </ActionButton>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        <span style={{ fontWeight: 600, fontSize: "var(--app-text-body)" }}>{label}</span>
        {backVisible && <BackToTodayButton label="Эта неделя" onClick={onBack} />}
      </span>
      <ActionButton onClick={onNext} aria-label="Следующая неделя">
        ›
      </ActionButton>
    </div>
  );
}

function DayStrip({ dates, selected, today, short, calendar, onSelect }: {
  dates: readonly string[];
  selected: string;
  today: string;
  /** Сколько людей не хватает в дне против нормы; дня без нехватки здесь нет. */
  short: ReadonlyMap<string, number>;
  /** Выходной красится по календарю, а не по дню недели: праздник в среду тоже серый. */
  calendar: DayCalendar;
  onSelect: (iso: string) => void;
}) {
  return (
    <div style={{ display: "flex", gap: 6 }}>
      {dates.map((iso) => (
        <DayChip key={iso} iso={iso} active={iso === selected} isToday={iso === today} short={short.get(iso) ?? 0} calendar={calendar} onSelect={() => onSelect(iso)} />
      ))}
    </div>
  );
}

function DayChip({ iso, active, isToday, short, calendar, onSelect }: { iso: string; active: boolean; isToday: boolean; short: number; calendar: DayCalendar; onSelect: () => void }) {
  const isDark = useIsDark();
  const weekend = isDayOff(iso, calendar);
  const kind = specialDayKind(iso, calendar.get(iso));
  // Невыбранный день — карточкой: холст теперь `secondary_bg_color`, и клетка
  // этого цвета на нём не читалась бы вовсе.
  const bg = active ? "var(--tgui--button_color)" : "var(--app-card)";
  const fg = active ? "var(--tgui--button_text_color)" : weekend ? "var(--tgui--hint_color)" : "var(--tgui--text_color)";
  return (
    <button
      type="button"
      onClick={onSelect}
      data-day-chip
      data-day-kind={kind}
      aria-current={isToday ? "date" : undefined}
      aria-pressed={active}
      data-day-short-outline={short > 0 ? "true" : undefined}
      // Праздник и рабочая суббота названы в подписи, а не только значком 🎉/💼:
      // значок скрыт от чтеца экрана вместе с остальной вёрсткой, и день читался бы обычным.
      aria-label={`${weekdayShort(iso)} ${dayOfMonth(iso)}${kind === "holiday" ? ", праздник" : kind === "workday" ? `, ${dayOfWeek(iso) === 0 ? "рабочее воскресенье" : "рабочая суббота"}` : ""}${short > 0 ? `, не хватает ${short}` : ""}`}
      style={{
        position: "relative",
        flex: 1,
        // Клетка и так выше 44px от содержимого; минимум задан явно, чтобы
        // он не просел, если кегль или число строк в ней поменяют.
        minHeight: "var(--app-tap)",
        border: "none",
        borderRadius: "var(--app-radius-control)",
        padding: "8px 0",
        background: bg,
        color: fg,
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 2,
        // Обводка, а не заливка: заливка занята под «выбран».
        boxShadow: [
          // Кольцо снаружи клетки, а не внутри: внутреннее на синей заливке выбранного
          // дня давало контраст 1.46 (тёмная) и 1.72 (светлая). Между клеткой и красным
          // — волосок цвета холста (1px), чтобы красное граничило с холстом, а не с
          // заливкой; вместе 3px, то есть ровно половина зазора между клетками (6px).
          // Красный — сам токен, не затемнённый: затемнённый на тёмном холсте
          // давал 2.54 при нужных 3.
          short > 0 ? "0 0 0 1px var(--app-canvas, var(--tgui--secondary_bg_color)), 0 0 0 3px var(--tgui--destructive_text_color)" : null,
          active ? (isDark ? "0 0 0 1px rgba(255,255,255,0.06)" : "0 1px 4px rgba(0,0,0,0.12)") : null,
        ].filter(Boolean).join(", ") || "none",
      }}
    >
      {/* В углу клетки, а не третьей строкой: высота полоски не меняется от
          того, есть ли на неделе дыры, и точка «сегодня» остаётся на месте.
          Обводка цветом клетки отделяет метку от синей заливки выбранного дня. */}
      {short > 0 && (
        <span
          data-day-short
          aria-hidden="true"
          style={{
            position: "absolute", top: -4, right: -2, minWidth: 16, height: 16, padding: "0 4px", boxSizing: "border-box",
            // Белое на «красном» клиента не дотягивает до 4.5 ни в одной теме
            // (замер: 4.28 и 4.01), поэтому красный затемнён. Без `color-mix` (Safari < 16.2)
            // — постоянный тёмно-красный #c62828: белый на нём 5.62.
            borderRadius: 999, background: mixOr("color-mix(in srgb, var(--tgui--destructive_text_color) 84%, #000)", "#c62828"), color: "#fff",
            fontSize: 10.5, fontWeight: 700, lineHeight: "16px", textAlign: "center",
            boxShadow: "0 0 0 2px var(--app-canvas, var(--tgui--secondary_bg_color))",
          }}
        >
          {short}
        </span>
      )}
      {/* Значок рядом с днём недели, а не новой строкой: высота клетки одна на всех. */}
      {/* Строка фиксированной высоты: эмодзи праздника тянул её, и неделя с отметкой
          выходила на 5px выше (60 против 55). */}
      <span style={{ fontSize: 11, lineHeight: "14px", height: 14, fontWeight: 500, opacity: 0.85, whiteSpace: "nowrap" }}>
        {weekdayShort(iso)}{kind ? ` ${kind === "holiday" ? "🎉" : "💼"}` : ""}
      </span>
      <span style={{ fontSize: "var(--app-text-body)", fontWeight: 600 }}>{dayOfMonth(iso)}</span>
      {/* «Выбран» and «сегодня» were the same style, so three weeks out you
          could not tell where you were. The dot is drawn independently of the
          selection and stays visible on the selected chip too. */}
      <span
        style={{
          width: 4,
          height: 4,
          borderRadius: 999,
          background: isToday ? (active ? fg : "var(--tgui--link_color)") : "transparent",
        }}
        aria-hidden="true"
      />
    </button>
  );
}

/**
 * What the badge says. The full preset name is written for the desktop grid
 * («Дежурство · Поклонка»), and on a phone it was wide enough to push the
 * worker's name AND their hours into an ellipsis — «Даша К…», «09:00–1…».
 * The row already says it's a duty by its colour, so the badge only has to
 * carry the part that tells the duties apart.
 */
export function badgeLabel(title: string | null, category: Category): string {
  const full = title ?? categoryLabel(category);
  const [prefix, rest] = full.split(" · ");
  return rest && prefix === "Дежурство" ? rest : full;
}

function EntryRow({ shift, templates, onTap }: { shift: Shift; templates: readonly Template[]; onTap: () => void }) {
  const name = shift.employeeName ?? "— не назначен —";
  const palette = personPalette(shift.employeeId);
  // The badge shows *which* preset (Утро/День/…) in that preset's own colour, so
  // the day reads at a glance instead of every shift being the same blue.
  const entryPalette = useEntryPalette(shift, templates);
  const badge = (
    <span
      style={{
        display: "inline-block",
        fontSize: "var(--app-text-meta)",
        fontWeight: 600,
        borderRadius: 999,
        padding: "4px 10px",
        whiteSpace: "nowrap",
        // Подстраховка: какой бы ни оказалась подпись, имя и часы сохраняют своё
        // место — плашка обрезается раньше них.
        maxWidth: 132,
        overflow: "hidden",
        textOverflow: "ellipsis",
        background: entryPalette.bg,
        color: entryPalette.fg,
      }}
    >
      {badgeLabel(shift.title, shift.category)}
    </span>
  );
  return (
    <Cell
      onClick={onTap}
      before={<Avatar acronym={shift.employeeId != null ? initialsOf(name) : "?"} size={40} style={{ background: palette.bg, color: palette.fg }} />}
      // Плашка смены стоит справа, а на узком экране (<360px, см. `.entry-badge`
      // в `index.css`) переезжает под имя, к часам: в 288px карточки справа она
      // отъедала столько, что имя резалось до «Аня Сми…» — а имя важнее плашки.
      // Узлов два, показан один из них; тексты у них одни и те же.
      subtitle={
        <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "2px 8px" }}>
          <span>{formatTimeRange(shift)}</span>
          <span className="entry-badge entry-badge--below">{badge}</span>
        </span>
      }
      after={<span className="entry-badge entry-badge--after">{badge}</span>}
    >
      {name}
    </Cell>
  );
}

interface EntryFormProps {
  employees: readonly Employee[];
  templates: readonly Template[];
  existing: Shift | null;
  defaultDate: string;
  /**
   * Праздники и рабочие субботы показанной недели. Обязательный: предпросмотр,
   * молча забывший праздники, обещал бы дни, которые сервер не поставит.
   */
  calendar: DayCalendar;
  onCancel: () => void;
  /** `summary` приходит только от расстановки диапазоном: у неё есть что сказать
   *  вслух — сколько дней встало и сколько пропущено. */
  onSaved: (notified: { delivered: number; intended: number }, summary?: string) => Promise<void>;
}

/**
 * Что именно выбрано в списке «Что ставим».
 *
 * Зеркало `Choice` из десктопной `AddEntryPanel`: у пресета категория своя, и
 * называть её отдельно приходится ровно в двух случаях — своё время (взять
 * неоткуда) и отсутствие (пресетов у него не бывает).
 */
type EntryChoice =
  | { kind: "preset"; templateId: number }
  | { kind: "custom"; category: Category }
  | { kind: "absence"; category: Category };

function initialEntryChoice(existing: Shift | null, presets: readonly Template[]): EntryChoice {
  if (existing) {
    if (existing.templateId != null && presets.some((t) => t.id === existing.templateId)) {
      return { kind: "preset", templateId: existing.templateId };
    }
    if (isAbsence(existing.category)) return { kind: "absence", category: existing.category };
    return { kind: "custom", category: existing.category };
  }
  const first = presets[0];
  return first ? { kind: "preset", templateId: first.id } : { kind: "custom", category: "shift" };
}

/**
 * Форма одной записи графика — зеркало десктопной `AddEntryPanel`, слово в слово.
 *
 * Шага «Категория» здесь больше нет: смены и дежурства идут одним списком
 * (`workPresets` из `@planer/shared` — тот же порядок, что в консоли), а
 * категория берётся из пресета. Спрашивается она ровно там, где её взять
 * неоткуда: «Своё время» и отсутствия.
 *
 * День — пара настоящих полей даты. Прежний выпадающий список предлагал семь
 * дат показанной недели, и поставить что-нибудь на следующий месяц было нельзя
 * вовсе.
 */
function EntryForm({ employees, templates, existing, defaultDate, calendar, onCancel, onSaved }: EntryFormProps) {
  const presets = workPresets(templates);

  const [employeeId, setEmployeeId] = useState<number>(existing?.employeeId ?? 0);
  const [from, setFrom] = useState<string>(existing?.date ?? defaultDate);
  const [to, setTo] = useState<string>(existing?.endDate ?? existing?.date ?? defaultDate);
  const [choice, setChoice] = useState<EntryChoice>(() => initialEntryChoice(existing, presets));
  const [start, setStart] = useState<string>(existing?.start ?? "09:00");
  const [end, setEnd] = useState<string>(existing?.end ?? "18:00");
  const [title, setTitle] = useState<string>(existing?.title ?? "");
  const [includeWeekends, setIncludeWeekends] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const selectedPreset = choice.kind === "preset" ? presets.find((t) => t.id === choice.templateId) : undefined;
  const category: Category = selectedPreset?.category ?? (choice.kind === "preset" ? "shift" : choice.category);
  const absence = isAbsence(category);
  const isFriday = weekdayIndex(from) === FRIDAY_INDEX;

  /**
   * Отрезок — и у создания, и у правки, но означает он разное: создание
   * заполняет пустые дни, правка переписывает занятые. «Изменить запись» на
   * неделю, молча пропускающая дни, где запись уже есть, не изменила бы ничего
   * и выглядела бы поломкой.
   *
   * Отсутствие в отрезок не попадает: в базе оно живёт ОДНОЙ строкой с
   * `endDate`, и правка его срока обязана остаться правкой той же строки — уйди
   * она в расстановку, рядом со старым отпуском появился бы второй.
   *
   * Зеркало десктопной `AddEntryPanel`, слово в слово.
   */
  const mode: EntryRangeMode = existing ? "rewrite" : "fill";
  const rangeAllowed = !(existing && absence);
  const isRange = rangeAllowed && to > from;
  const showTo = rangeAllowed || absence;
  const plan = planEntryRange({ from, to, category, includeWeekends, mode, calendar });

  /** Значение списка «Что ставим»: пресет по id, «своё время» или отсутствие по категории. */
  const choiceValue = choice.kind === "preset" ? `p:${choice.templateId}` : choice.kind === "custom" ? "custom" : `a:${choice.category}`;

  function selectChoice(value: string) {
    setFormError(null);
    if (value === "custom") {
      setChoice({ kind: "custom", category: absence ? "shift" : category });
      return;
    }
    if (value.startsWith("a:")) {
      setChoice({ kind: "absence", category: value.slice(2) as Category });
      return;
    }
    const templateId = Number(value.slice(2));
    setChoice({ kind: "preset", templateId });
    // Место пресета приезжает в подпись — пригодится, если человек потом
    // переключится на «Своё время».
    const template = presets.find((t) => t.id === templateId);
    if (template?.location != null) setTitle(template.location);
  }

  /** Общая часть тела для обеих ручек — одна, чтобы они не разъехались. */
  function entryFields(): Omit<NewEntryInput, "date"> | null {
    // `null`, а не пропущенное поле: у правки пропуск для сервера значит «не
    // менять», и выбор «— не назначен —» оставлял запись у прежнего человека.
    // Сервер принимает null и при создании, и при правке (`nullish`).
    const base = { employeeId: employeeId || null };
    if (selectedPreset) {
      const times = resolveShiftTimes(selectedPreset, from);
      return {
        ...base,
        category: selectedPreset.category,
        templateId: selectedPreset.id,
        start: times.start,
        end: times.end,
        // Подпись всегда идёт за пресетом: иначе правка «Дня» на «Утро» оставила
        // бы старое имя.
        title: selectedPreset.name,
      };
    }
    if (absence) return { ...base, category };
    if (!start || !end) {
      setFormError("Укажите время начала и окончания");
      return null;
    }
    return {
      ...base,
      category,
      start,
      end,
      // Место дежурства и мероприятия несёт подпись; у смены со своим временем её нет.
      title: category === "duty" || category === "offsite" ? title.trim() || null : null,
    };
  }

  async function handleSave() {
    setFormError(null);
    if (to < from) {
      setFormError("«По» не может быть раньше, чем «с»");
      return;
    }
    if (isRange && plan.days.length === 0) {
      setFormError("В этом диапазоне не остаётся ни одного дня");
      return;
    }
    const fields = entryFields();
    if (!fields) return;

    setSaving(true);
    try {
      if (isRange) {
        if (!employeeId) {
          setFormError("Выберите работника");
          return;
        }
        const result = await apiClient.createEntryRange({ ...fields, employeeId, from, to, includeWeekends, mode });
        await onSaved(result.notified, describeEntryRangeResult(result));
      } else {
        const input: NewEntryInput = { ...fields, date: from };
        // Полоса отсутствия — единственный случай, когда `endDate` доезжает до базы.
        if (absence && to !== from) input.endDate = to;
        const { notified } = existing
          ? await apiClient.updateEntry(existing.id, input)
          : await apiClient.createEntry(input);
        await onSaved(notified);
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Не удалось сохранить запись");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!existing) return;
    setDeleting(true);
    setFormError(null);
    try {
      const { notified } = await apiClient.deleteEntry(existing.id);
      await onSaved(notified);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Не удалось удалить запись");
    } finally {
      setDeleting(false);
    }
  }

  const busy = saving || deleting;

  return (
    <Card>
      <PersonPicker
        label="Работник"
        people={employees}
        value={employeeId}
        onChange={setEmployeeId}
        emptyOptionLabel="— не назначен —"
      />

      {/* `wrap` и `minWidth: 0`: нативное поле даты не уже ~140px, и на 320px два
          рядом (по 126px) выпихивали «По» за край карточки и давали горизонтальную
          прокрутку всего экрана. Узкий экран — друг под другом. */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <div style={{ flex: "1 1 140px", minWidth: 0 }}>
          <Input
            header={showTo ? "С" : "День"}
            type="date"
            value={from}
            onChange={(e) => {
              const next = e.target.value;
              setFrom(next);
              if (next > to) setTo(next);
            }}
          />
        </div>
        {showTo && (
          <div style={{ flex: "1 1 140px", minWidth: 0 }}>
            <Input header="По" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </div>
        )}
      </div>

      {/* Смены и дежурства в одном списке, без шага «Категория»: до 2026-08-21
          увидеть дежурство, не сказав сперва «Дежурство», было нельзя. */}
      <SelectField stretched label={`Что ставим${isFriday ? " · пятница, сокращённый" : ""}`} value={choiceValue} onChange={selectChoice}>
        {presets.map((t) => {
          const times = resolveShiftTimes(t, from);
          return (
            <option key={t.id} value={`p:${t.id}`}>
              {t.name} · {times.start}–{times.end}
            </option>
          );
        })}
        <option value="custom">Своё время</option>
        {ABSENCE_CATEGORIES.map((c) => (
          <option key={c} value={`a:${c}`}>
            {categoryLabel(c as Category)}
          </option>
        ))}
      </SelectField>

      {choice.kind === "custom" && (
        <>
          <TimeRow start={start} end={end} onStart={setStart} onEnd={setEnd} />
          {/* Здесь категорию всё-таки спрашиваем: у записи без пресета взять её
              неоткуда, и это единственное место, где она осталась вопросом. */}
          <SelectField stretched label="Вид" value={category} onChange={(value) => setChoice({ kind: "custom", category: value as Category })}>
            {CUSTOM_TIME_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {categoryLabel(c as Category)}
              </option>
            ))}
          </SelectField>
        </>
      )}

      {(category === "duty" || category === "offsite") && choice.kind !== "preset" && (
        <Input
          header="Место / примечание"
          placeholder={category === "duty" ? "Например, Вавилова" : "Например, Ярмарка вакансий"}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      )}

      {isRange && !absence && (
        <>
          <CheckRow checked={includeWeekends} onChange={setIncludeWeekends} label="Включая выходные" />
          <div data-testid="range-preview" style={{ fontSize: "var(--app-text-meta)", color: "var(--tgui--hint_color)", lineHeight: 1.4 }}>
            Поставится {describeEntryRangePlan(plan)}. {entryRangeHint(mode)}
          </div>
        </>
      )}

      {formError && <div style={{ color: "var(--tgui--destructive_text_color)", fontSize: "var(--app-text-meta)" }}>{formError}</div>}

      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        <ActionButton kind="primary" stretched loading={saving} disabled={busy} onClick={() => void handleSave()}>
          {existing ? "Сохранить" : "Добавить"}
        </ActionButton>
        <ActionButton disabled={busy} onClick={onCancel}>
          Отмена
        </ActionButton>
      </div>
      {existing && (
        <ConfirmButton
          label="Удалить запись"
          question="Удалить эту запись из графика? Человеку придёт письмо об изменении."
          confirmLabel="Да, удалить"
          compact={false}
          mode="plain"
          loading={deleting}
          disabled={busy}
          onConfirm={() => void handleDelete()}
        />
      )}
    </Card>
  );
}

function TimeRow({ start, end, onStart, onEnd }: { start: string; end: string; onStart: (v: string) => void; onEnd: (v: string) => void }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      <div style={{ flex: "1 1 120px", minWidth: 0 }}>
        <Input header="Начало" type="time" value={start} onChange={(e) => onStart(e.target.value)} />
      </div>
      <div style={{ flex: "1 1 120px", minWidth: 0 }}>
        <Input header="Конец" type="time" value={end} onChange={(e) => onEnd(e.target.value)} />
      </div>
    </div>
  );
}

export interface FillWeekPanelProps {
  employees: readonly Employee[];
  templates: readonly Template[];
  weekDates: readonly string[];
  /** Праздники недели: «на всю неделю» их пропускает так же, как Сб и Вс. */
  calendar: DayCalendar;
  onCancel: () => void;
  onFilled: (count: number, notified: { delivered: number; intended: number }) => Promise<void>;
}

/**
 * "Заполнить неделю": pick a worker, choose a preset (or "выходной") per day of
 * the visible week, and create one entry per chosen day in a single pass.
 *
 * Рядом стояла таблица «смены на неделе по видам» со «★ — кому раздача отдаст
 * следующую». Она ушла вместе с самой раздачей: подсказка про решение функции,
 * которой больше нет, — это не подсказка.
 */
export function FillWeekPanel({ employees, templates, weekDates, calendar, onCancel, onFilled }: FillWeekPanelProps) {
  const [employeeId, setEmployeeId] = useState<number>(employees[0]?.id ?? 0);
  /** Per-day choice, encoded: "" = выходной, "p:<id>" = preset, "c:<category>" = a
   * category that has no preset (отпуск/больничный/командировка/…). Same option set
   * as the single-entry form, so both surfaces offer identical choices. */
  const [byDay, setByDay] = useState<Record<string, string>>(() =>
    Object.fromEntries(weekDates.map((iso) => [iso, ""])),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chosenDays = weekDates.filter((iso) => byDay[iso]);
  /** Categories with no preset of their own — offered directly alongside the presets. */
  const plainCategories = ORDERED_CATEGORIES.filter((c) => !templates.some((t) => t.category === c));

  function templateTimesFor(template: Template, iso: string): { start: string; end: string } {
    return resolveShiftTimes(template, iso);
  }

  function setDay(iso: string, value: string) {
    setByDay((prev) => ({ ...prev, [iso]: value }));
  }

  /** Convenience: apply one choice to every WEEKDAY — выходные по календарю
   * (Сб/Вс и праздники) stay "выходной" unless set by hand, since a blanket fill
   * shouldn't silently roster a day off. Passing "" clears every day. */
  function setWholeWeek(value: string) {
    setByDay(Object.fromEntries(weekDates.map((iso) => [iso, value && isDayOff(iso, calendar) ? "" : value])));
  }

  async function handleFill() {
    if (!employeeId) {
      setError("Сначала выберите работника");
      return;
    }
    if (chosenDays.length === 0) {
      setError("Выберите хотя бы один день");
      return;
    }
    setError(null);
    setSaving(true);
    const inputs: NewEntryInput[] = [];
    for (const iso of chosenDays) {
      const choice = byDay[iso]!;
      let input: NewEntryInput;
      if (choice.startsWith("p:")) {
        const template = templates.find((t) => t.id === Number(choice.slice(2)));
        if (!template) continue;
        const times = templateTimesFor(template, iso);
        // Same preset→entry mapping as EntryForm: category/times from the preset,
        // title = preset name (which carries the place for a duty preset).
        input = {
          date: iso,
          category: template.category,
          employeeId,
          templateId: template.id,
          start: times.start,
          end: times.end,
          title: template.name,
        };
      } else {
        // A category with no preset: absences carry no times; a timed one gets
        // sensible defaults the admin can refine on the entry afterwards.
        const category = choice.slice(2) as Category;
        input = { date: iso, category, employeeId };
        if (needsTime(category)) {
          input.start = "09:00";
          input.end = "18:00";
        }
      }
      inputs.push(input);
    }
    try {
      // Один запрос, а не цикл: семь `POST /api/admin/entries` подряд — это семь
      // писем человеку за одно нажатие «Заполнить». Bulk-роут атомарен и шлёт
      // одно сводное письмо независимо от числа дней.
      const { created, notified } = await apiClient.createEntries(inputs);
      await onFilled(created, notified);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось заполнить неделю");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      {/* Не фильтруем: «Заполнить неделю» — ручная постановка, админ называет
          человека сам, и по решению заказчика это разрешено. Пометка нужна, чтобы
          не выбрать по инерции того, кого бот сам никогда бы не поставил. */}
      <PersonPicker
        label="Работник"
        people={employees}
        value={employeeId}
        onChange={setEmployeeId}
        emptyOptionLabel="— выберите —"
        // Эффективное право, не сырая галочка: наблюдатель (`isObserver`) вне
        // раздачи ровно так же, как и человек с поднятым `excludedFromAssignment`,
        // а роль его галочку не трогает — без этого он шёл бы без пометки.
        note={(e) => (!takesPartInAssignment(e) ? "· вне назначений" : null)}
      />

      <SelectField stretched label="Все будни одним вариантом (Сб/Вс не трогаем)" value="" onChange={setWholeWeek}>
        <option value="">— по дням —</option>
        {templates.map((t) => (
          <option key={t.id} value={`p:${t.id}`}>
            {t.name}
          </option>
        ))}
        {plainCategories.map((c) => (
          <option key={c} value={`c:${c}`}>
            {categoryLabel(c)}
          </option>
        ))}
      </SelectField>

      {weekDates.map((iso) => (
        <SelectField stretched key={iso} label={formatDayLabel(iso)} value={byDay[iso] ?? ""} onChange={(value) => setDay(iso, value)}>
          <option value="">— выходной —</option>
          {templates.map((t) => {
            const times = templateTimesFor(t, iso);
            return (
              <option key={t.id} value={`p:${t.id}`}>
                {t.name} · {times.start}–{times.end}
              </option>
            );
          })}
          {plainCategories.map((c) => (
            <option key={c} value={`c:${c}`}>
              {categoryLabel(c)}
            </option>
          ))}
        </SelectField>
      ))}

      {error && <div style={{ color: "var(--tgui--destructive_text_color)", fontSize: "var(--app-text-meta)" }}>{error}</div>}
      {/* Один запрос вместо цикла — заполняется не по одному дню, поэтому
          "N из M" посреди сохранения было бы враньём: savedCount равен нулю
          до самого ответа сервера, а не растёт по ходу. */}
      {saving && <div style={{ color: "var(--tgui--hint_color)", fontSize: "var(--app-text-meta)" }}>Сохранение…</div>}

      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        <ActionButton kind="primary" stretched loading={saving} disabled={saving} onClick={() => void handleFill()}>
          Заполнить{chosenDays.length > 0 ? ` (${chosenDays.length})` : ""}
        </ActionButton>
        <ActionButton disabled={saving} onClick={onCancel}>
          Отмена
        </ActionButton>
      </div>
    </Card>
  );
}

