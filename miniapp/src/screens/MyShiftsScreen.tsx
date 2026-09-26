import { Fragment, useEffect, useRef, useState } from "react";
import { Button, List, Placeholder, Section } from "@telegram-apps/telegram-ui";
import { canAddOwnShifts, isAbsence, swapBlockReason } from "@planer/shared";
import type { StartTab } from "@planer/shared";
import type { Me, Shift, Template } from "../api/client";
import type { SelfEntryMode } from "./SelfEntryScreen";
import { AddressField } from "../components/AddressField";
import { CalendarSection } from "../components/CalendarSection";
import { ChecklistCard } from "../components/ChecklistCard";
import { DayTeamList } from "../components/DayTeamList";
import { GreetingHero } from "../components/GreetingHero";
import { ScreenScroll, TAB_BAR_CLEARANCE } from "../components/ScreenScroll";
import { ShiftRow } from "../components/ShiftRow";
import { RemindersSwitch } from "../components/RemindersSwitch";
import { StartTabPicker } from "../components/StartTabPicker";
import { SelfScheduleSwitch } from "../components/SelfScheduleSwitch";
import { coworkersOf } from "../lib/coworkers";
import { groupUpcomingByWeek, remainingThisWeek } from "../lib/upcoming";
import { pluralizeRu } from "../lib/shift";

// Причина одна на весь экран, и её порядок берётся у той же функции, что решает
// на сервере. `toExcluded: false` — здесь речь только про меня; исключённые
// коллеги отсеиваются отдельно, в списке кандидатов.
const BLOCK_PHRASES = {
  "swaps-locked": "Обмены сейчас закрыты",
  "from-excluded": "Обмены тебе закрыты — спроси у админа",
  "to-excluded": "Обмены тебе закрыты — спроси у админа",
} as const;

export interface MyShiftsScreenProps {
  me: Me;
  /** Сегодняшняя дата в часовом поясе команды — приходит с сервера вместе со
   *  сменами. Не `new Date()`: граница дня не должна зависеть от того, где
   *  физически находится телефон. */
  today: string;
  /** Ближайшие записи: сегодня и дальше, без верхней границы. */
  shifts: Shift[];
  /** Presets, to colour each row by the one its entry came from. */
  templates: readonly Template[];
  /** Opens the "Предложить обмен" flow for the tapped shift. */
  onProposeSwap: (shift: Shift) => void;
  /** Открывает форму больничного, мероприятия или (для наблюдателя) своей
   *  смены — тот же оверлей, в который ведут кнопки бота. */
  onSelfEntry: (mode: SelfEntryMode) => void;
  /** Keeps `me` in step when the reminders switch is flipped. */
  onRemindersChanged: (enabled: boolean) => void;
  /** Стартовая вкладка — личная настройка, живёт рядом с напоминаниями. */
  onStartTabChanged: (tab: StartTab | null) => void;
  /** Keeps `me` in step when the self-schedule switch is flipped — наблюдатель. */
  onSelfScheduleChanged: (enabled: boolean) => void;
  /** Keeps `me` in step when the greeting name is saved. */
  onAddressChanged: (next: { preferredName: string | null; address: string }) => void;
  /** Расписание дня раскрытой строки — тот же загрузчик, что кормит экран
   *  обмена (см. `App.tsx`). `null`, пока не пришло или дата не совпадает с
   *  раскрытой строкой (предыдущий день ещё висит в памяти, пока грузится новый). */
  openDay: { date: string; shifts: Shift[] } | null;
  openDayLoading: boolean;
  openDayError: string | null;
  /** Тап по своей смене: раскрыть её лист (передаётся смена) или закрыть
   *  (передаётся `null`) — экран сам решает, какая строка раскрыта сейчас. */
  onToggleCoworkers: (shift: Shift | null) => void;
}

/** «Мои смены»: приветствие с остатком недели, ближайшие записи секциями по
 *  неделям, и переключатель напоминаний. Прошедших дней здесь нет. */
export function MyShiftsScreen({
  me,
  today,
  shifts,
  templates,
  onProposeSwap,
  onSelfEntry,
  onRemindersChanged,
  onStartTabChanged,
  onSelfScheduleChanged,
  onAddressChanged,
  openDay,
  openDayLoading,
  openDayError,
  onToggleCoworkers,
}: MyShiftsScreenProps) {
  // Какая строка раскрыта — состояние экрана, а не App: тап переключает её
  // локально и мгновенно (сворачивание не должно ждать сети), а сами данные
  // дня — снаружи, по той же причине, что и у «Предложить обмен».
  const [expandedShiftId, setExpandedShiftId] = useState<number | null>(null);

  // Отсутствие (отпуск/больничный/командировка) не открывает лист: у него нет
  // часов — «с кем рядом» отвечать нечем, — а многодневная запись к тому же
  // рисуется под ПЕРВЫМ днём своего диапазона, так что «сегодня» дня, который
  // ушёл бы в запрос, почти всегда не тот, что человек видит на экране (было
  // видно на скриншоте: лист открывался под «Отпуск» и грузил вчерашний день).
  function coworkersOpenable(shift: Shift): boolean {
    return !isAbsence(shift.category) && shift.start != null;
  }

  function handleRowOpen(shift: Shift) {
    if (expandedShiftId === shift.id) {
      setExpandedShiftId(null);
      onToggleCoworkers(null);
    } else {
      setExpandedShiftId(shift.id);
      onToggleCoworkers(shift);
    }
  }

  const weeks = groupUpcomingByWeek(shifts, today);
  const rest = remainingThisWeek(shifts, today);
  const summary =
    rest.count > 0
      ? `Осталось на этой неделе — ${rest.count} ${pluralizeRu(rest.count, "смена", "смены", "смен")} · ${Math.round(rest.hours)} ч`
      : "На этой неделе смен больше нет";
  // Считаем один раз на весь экран и раздаём каждой строке. Порядок причин не
  // переписан руками — он приходит от той же функции, что решает на сервере,
  // чтобы кнопка не могла разъехаться с ним после следующей правки там.
  const blocked = swapBlockReason({
    swapsLocked: me.swapsLocked,
    fromExcluded: me.excludedFromSwaps,
    toExcluded: false,
  });
  const swapBlockedReason = blocked ? BLOCK_PHRASES[blocked] : undefined;

  return (
    <ScreenScroll>
      <div style={{ margin: "4px 4px 20px" }}>
        {/* `me.address` comes from the server, which knows the person's Telegram
            first name. Splitting `displayName` here gave «Привет, Петров» — the
            roster is written «Фамилия Имя». See `addressOf` in @planer/shared. */}
        <GreetingHero name={me.address} summary={summary} />
      </div>

      {/* Чек-лист — самое верхнее, что есть на экране в тот день, когда он
          положен: человек открывает мини-аппу по кнопке из утреннего
          сообщения, и искать его под списком смен ему незачем. В остальные
          дни карточки нет вовсе. */}
      <ChecklistCard today={today} />

      {/* Вход в самозапись стоит НАД списком смен: список не имеет нижней
          границы, и кнопка под ним у человека с плотным графиком оказалась бы
          за десятком экранов прокрутки. Те же две формы открывают кнопки бота. */}
      <List>
        <Section header="Записать себе">
          <div style={{ display: "flex", gap: 8, padding: "4px 12px 12px" }}>
            <Button size="m" stretched mode="bezeled" onClick={() => onSelfEntry("sick")}>
              🤒 Больничный
            </Button>
            <Button size="m" stretched mode="bezeled" onClick={() => onSelfEntry("event")}>
              📌 Мероприятие
            </Button>
            {/* Эффективное право (`canAddOwnShifts`), не сырой тумблер: снятие роли
                намеренно не гасит `selfScheduleEnabled` в БД (см. спеку), поэтому у
                бывшего наблюдателя галочка может остаться поднятой — кнопка, ведущая
                на форму, которая никогда не откроется (`App.tsx`), и отвечающая 403
                на каждое нажатие, хуже отсутствующей. */}
            {canAddOwnShifts(me) && (
              <Button size="m" stretched mode="bezeled" onClick={() => onSelfEntry("shift")}>
                🕒 Поставить себе смену
              </Button>
            )}
          </div>
        </Section>
      </List>

      {weeks.length === 0 ? (
        <Placeholder header="Пока нет смен" description="Здесь появятся ваши ближайшие смены и отпуска." />
      ) : (
        <List>
          <Section header="Ближайшие смены">
            {weeks.map((week) => (
              <Section key={week.key} header={week.label}>
                {week.shifts.map((shift) => (
                  // `Fragment`, не `div`: `Section` считает дивайдеры по числу
                  // ПРЯМЫХ детей (`Children.map` в её исходнике) — обёртка-`div`
                  // добавила бы лишний узел в этот счёт и не изменила бы место
                  // дивайдера, а `Fragment` даёт строку и раскрытый под ней лист
                  // одной группой без лишнего DOM-узла.
                  <Fragment key={shift.id}>
                    <ShiftRow
                      shift={shift}
                      templates={templates}
                      onSwap={onProposeSwap}
                      onOpen={coworkersOpenable(shift) ? handleRowOpen : undefined}
                      isToday={shift.date === today}
                      swapBlockedReason={swapBlockedReason}
                    />
                    {expandedShiftId === shift.id && (
                      <CoworkersPanel
                        shift={shift}
                        meId={me.id}
                        openDay={openDay}
                        loading={openDayLoading}
                        error={openDayError}
                      />
                    )}
                  </Fragment>
                ))}
              </Section>
            ))}
          </Section>
        </List>
      )}

      <List>
        <Section header="Уведомления">
          <RemindersSwitch enabled={me.remindersEnabled} onChanged={onRemindersChanged} />
          {/* Здесь же, а не отдельным экраном настроек: это личная настройка, а
              «Мои смены» — экран, который открывают все. */}
          <StartTabPicker me={me} onChanged={onStartTabChanged} />
          {/* Рядом с напоминаниями, не отдельной секцией: это тоже личная
              настройка, а не общий раздел — и видна только наблюдателю. */}
          {me.isObserver && (
            <SelfScheduleSwitch enabled={me.selfScheduleEnabled} onChanged={onSelfScheduleChanged} />
          )}
        </Section>
      </List>

      {/* Своим запросом, не из bootstrap: токен подписки нарочно не отдаётся
          там (см. CalendarSection) — раздел спрашивает сам, когда открыт. */}
      <List>
        <Section header="Календарь">
          <CalendarSection />
        </Section>
      </List>

      <List>
        <Section header="Обращение">
          <AddressField
            preferredName={me.preferredName}
            address={me.address}
            onSaved={onAddressChanged}
          />
        </Section>
      </List>
    </ScreenScroll>
  );
}

/**
 * Раскрывающийся лист под тапнутой строкой: «Кто ещё работает» этот день.
 *
 * Плоский `div`, не `Cell`: `Cell`/`Tappable` несёт свой рипл- и hover-фон на
 * весь блок — тот же дефект, что уже разбирали в «Записать себе». Свой фон
 * этому `div` не задан нарочно: он, как и строка над ним, прямой ребёнок
 * `Section`, а фон карточки красит именно она (`var(--tgui--section_bg_color)`
 * на её обёртке) — задать здесь ещё и «свой» цвет означало бы гадать его
 * заново вместо того, чтобы получить точно тот же по построению. Замер
 * (headless, 390×844): фон блока и фон строки совпадают в обеих темах.
 */
function CoworkersPanel({
  shift,
  meId,
  openDay,
  loading,
  error,
}: {
  shift: Shift;
  meId: number;
  openDay: { date: string; shifts: Shift[] } | null;
  loading: boolean;
  error: string | null;
}) {
  const matches = openDay != null && openDay.date === shift.date;
  const list = matches ? coworkersOf(openDay.shifts, meId) : [];
  const panelRef = useRef<HTMLDivElement>(null);
  // Готов показывать окончательное содержимое — не «Загружаю…», которое почти
  // всегда короче итогового списка.
  const settled = error != null || (!loading && matches);

  // Лист раскрывается под строкой, а строка может быть у самого низа экрана —
  // мини-апп один длинный скролл без своего скролл-контейнера. Голый
  // `scrollIntoView({block: "nearest"})` этого не чинит: он метит в границы
  // ВЬЮПОРТА, а не в то, что от него реально видно, — нижняя панель вкладок
  // (`position: fixed`, 758–844 из 844 на замере 390×844) перекрывает ровно
  // тот кусок вьюпорта, куда он и целится, так что «докрученный» лист всё
  // равно рисовался за баром (проверено `elementFromPoint`: кнопка таб-бара, а
  // не текст листа). `scrollMarginBottom` — тот же `TAB_BAR_CLEARANCE`, что
  // `ScreenScroll` уже держит в самом низу каждого экрана (см. её комментарий):
  // `scrollIntoView` учитывает `scroll-margin` нативно, и это ровно то число,
  // которым уже посчитана высота бара плюс отступ на вырез снизу.
  //
  // Докрутка — ПОСЛЕ того, как содержимое устоялось: докрути раньше — высота
  // ещё спиннера, а не итогового списка, и прокрутки не хватит.
  // `?.` дважды — jsdom в тестах этот метод не реализует вовсе.
  useEffect(() => {
    if (!settled) return;
    panelRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [settled]);

  return (
    <div
      ref={panelRef}
      style={{ padding: "2px 20px 14px", fontSize: 14, lineHeight: 1.4, scrollMarginBottom: TAB_BAR_CLEARANCE }}
    >
      <div style={{ color: "var(--tgui--hint_color)", fontSize: 12.5, marginBottom: 6 }}>
        Кто ещё работает в этот день:
      </div>
      {error ? (
        <span style={{ color: "var(--tgui--destructive_text_color)" }}>{error}</span>
      ) : loading || !matches ? (
        <span style={{ color: "var(--tgui--hint_color)" }}>Загружаю…</span>
      ) : list.length === 0 ? (
        <span style={{ color: "var(--tgui--hint_color)" }}>Никого, кроме тебя</span>
      ) : (
        <DayTeamList shifts={list} />
      )}
    </div>
  );
}
