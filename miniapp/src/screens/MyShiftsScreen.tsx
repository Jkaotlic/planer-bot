import { Button, List, Placeholder, Section } from "@telegram-apps/telegram-ui";
import { canAddOwnShifts, swapBlockReason } from "@planer/shared";
import type { Me, Shift, Template } from "../api/client";
import type { SelfEntryMode } from "./SelfEntryScreen";
import { AddressField } from "../components/AddressField";
import { GreetingHero } from "../components/GreetingHero";
import { ScreenScroll } from "../components/ScreenScroll";
import { ShiftRow } from "../components/ShiftRow";
import { RemindersSwitch } from "../components/RemindersSwitch";
import { SelfScheduleSwitch } from "../components/SelfScheduleSwitch";
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
  /** Keeps `me` in step when the self-schedule switch is flipped — наблюдатель. */
  onSelfScheduleChanged: (enabled: boolean) => void;
  /** Keeps `me` in step when the greeting name is saved. */
  onAddressChanged: (next: { preferredName: string | null; address: string }) => void;
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
  onSelfScheduleChanged,
  onAddressChanged,
}: MyShiftsScreenProps) {
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
                  <ShiftRow
                    key={shift.id}
                    shift={shift}
                    templates={templates}
                    onSwap={onProposeSwap}
                    isToday={shift.date === today}
                    swapBlockedReason={swapBlockedReason}
                  />
                ))}
              </Section>
            ))}
          </Section>
        </List>
      )}

      <List>
        <Section header="Уведомления">
          <RemindersSwitch enabled={me.remindersEnabled} onChanged={onRemindersChanged} />
          {/* Рядом с напоминаниями, не отдельной секцией: это тоже личная
              настройка, а не общий раздел — и видна только наблюдателю. */}
          {me.isObserver && (
            <SelfScheduleSwitch enabled={me.selfScheduleEnabled} onChanged={onSelfScheduleChanged} />
          )}
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
