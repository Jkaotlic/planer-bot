import { swapBlockedFor } from "../lib/swaps";
import { nowOnTeamDay } from "../lib/swap-candidates";
import { useEffect, useRef, useState } from "react";
import { Placeholder } from "@telegram-apps/telegram-ui";
import { canAddOwnShifts, isAbsence, swapBlockReason } from "@planer/shared";
import type { Me, Shift, Template } from "../api/client";
import type { SelfEntryMode } from "./SelfEntryScreen";
import { ChecklistCard } from "../components/ChecklistCard";
import { DayTeamList } from "../components/DayTeamList";
import { GreetingHero } from "../components/GreetingHero";
import { ShiftRow } from "../components/ShiftRow";
import { coworkersOf } from "../lib/coworkers";
import { groupUpcomingByWeek, remainingThisWeek } from "../lib/upcoming";
import { pluralizeRu } from "../lib/shift";
import { ActionButton, Card, Group, Screen, TAB_BAR_CLEARANCE } from "../ui";

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
  /** Открывает экран «Настройки» — шестерёнка в приветствии. */
  onOpenSettings: () => void;
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

/** «Мои смены»: приветствие с остатком недели (и шестерёнкой в «Настройки»),
 *  вход в самозапись и ближайшие записи по неделям. Прошедших дней здесь нет. */
export function MyShiftsScreen({
  me,
  today,
  shifts,
  templates,
  onProposeSwap,
  onSelfEntry,
  onOpenSettings,
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
    <Screen>
      {/* Заголовка у главной вкладки нет на виду (её называет таб-бар), но у
          страницы он нужен скринридеру — как у остальных вкладок. */}
      <h1 className="visually-hidden">Смены</h1>
      {/* `me.address` приходит с сервера: он знает имя из Telegram. Делить
          `displayName` здесь давало «Привет, Петров» — ростер пишется «Фамилия
          Имя». См. `addressOf` в @planer/shared. */}
      <GreetingHero name={me.address} summary={summary} onSettings={onOpenSettings} />

      {/* Чек-лист — самое верхнее в день, когда он положен: человек открывает
          мини-апп по кнопке из утреннего сообщения. В остальные дни его нет. */}
      <ChecklistCard today={today} />

      {/* Вход в самозапись стоит НАД списком смен: у списка нет нижней границы,
          и кнопка под ним у человека с плотным графиком оказалась бы за десятком
          экранов прокрутки. */}
      <Group header="Записать себе">
        {/* `wrap`: у наблюдателя с «Веду график сам» кнопок три; третья —
            строкой ниже на всю ширину. */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <span style={{ flex: "1 1 40%", display: "flex" }}>
            <ActionButton stretched onClick={() => onSelfEntry("sick")}>🤒 Больничный</ActionButton>
          </span>
          <span style={{ flex: "1 1 40%", display: "flex" }}>
            <ActionButton stretched onClick={() => onSelfEntry("event")}>📌 Мероприятие</ActionButton>
          </span>
          {/* Эффективное право (`canAddOwnShifts`), не сырой тумблер: снятие роли
              намеренно не гасит `selfScheduleEnabled` в БД, и кнопка, ведущая на
              форму с отказом 403, хуже отсутствующей. */}
          {canAddOwnShifts(me) && (
            <span style={{ flexBasis: "100%", display: "flex" }}>
              <ActionButton stretched onClick={() => onSelfEntry("shift")}>🕒 Поставить себе смену</ActionButton>
            </span>
          )}
        </div>
      </Group>

      {weeks.length === 0 ? (
        <Placeholder header="Пока нет смен" description="Здесь появятся ваши ближайшие смены и отпуска." />
      ) : (
        // Один заголовок на неделю. Общий «Ближайшие смены» над ним убран:
        // два заголовка подряд говорили одно и то же.
        weeks.map((week) => (
          <Group key={week.key} header={week.label}>
            <Card flush>
              {week.shifts.map((shift) => (
                // Один `div` на строку вместе с раскрытым листом: разделитель
                // `Card flush` ставится между прямыми детьми, и лист не должен
                // отделяться линией от своей же строки.
                <div key={shift.id}>
                  <ShiftRow
                    shift={shift}
                    templates={templates}
                    onSwap={onProposeSwap}
                    onOpen={coworkersOpenable(shift) ? handleRowOpen : undefined}
                    expanded={expandedShiftId === shift.id}
                    isToday={shift.date === today}
                    swapBlockedReason={swapBlockedFor(shift, today, nowOnTeamDay(today), swapBlockedReason)}
                  />
                  {expandedShiftId === shift.id && (
                    <CoworkersPanel shift={shift} meId={me.id} openDay={openDay} loading={openDayLoading} error={openDayError} />
                  )}
                </div>
              ))}
            </Card>
          </Group>
        ))
      )}
    </Screen>
  );
}

/**
 * Раскрывающийся лист под тапнутой строкой: «Кто ещё работает» этот день.
 *
 * Плоский `div`, не `Cell`: `Cell`/`Tappable` несёт свой рипл- и hover-фон на
 * весь блок — тот же дефект, что уже разбирали в «Записать себе». Свой фон
 * этому `div` не задан нарочно: он, как и строка над ним, лежит внутри `Card`,
 * а фон красит именно она — задать здесь ещё и «свой» цвет означало бы гадать
 * его заново вместо того, чтобы получить точно тот же по построению.
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
  // не текст листа). `scrollMarginBottom` — тот же `TAB_BAR_CLEARANCE`
  // (96px плюс вырез), что в нижнем `padding` `.ui-screen`: там он оставляет
  // место в конце страницы, здесь — отступ цели докрутки. `scrollIntoView`
  // учитывает `scroll-margin` нативно, поэтому лист встаёт над баром.
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
      style={{ padding: "2px 14px 14px", fontSize: 14, lineHeight: 1.4, scrollMarginBottom: TAB_BAR_CLEARANCE }}
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
