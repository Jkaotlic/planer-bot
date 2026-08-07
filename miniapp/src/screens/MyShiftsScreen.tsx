import { List, Placeholder, Section } from "@telegram-apps/telegram-ui";
import type { Me, Shift, Template } from "../api/client";
import { AddressField } from "../components/AddressField";
import { GreetingHero } from "../components/GreetingHero";
import { ScreenScroll } from "../components/ScreenScroll";
import { ShiftRow } from "../components/ShiftRow";
import { RemindersSwitch } from "../components/RemindersSwitch";
import { groupUpcomingByWeek, remainingThisWeek } from "../lib/upcoming";
import { pluralizeRu } from "../lib/shift";

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
  /** Keeps `me` in step when the reminders switch is flipped. */
  onRemindersChanged: (enabled: boolean) => void;
  /** Keeps `me` in step when the greeting name is saved. */
  onAddressChanged: (next: { preferredName: string | null; address: string }) => void;
}

/** «Мои смены»: приветствие с остатком недели, ближайшие записи секциями по
 *  неделям, и переключатель напоминаний. Прошедших дней здесь нет. */
export function MyShiftsScreen({ me, today, shifts, templates, onProposeSwap, onRemindersChanged, onAddressChanged }: MyShiftsScreenProps) {
  const weeks = groupUpcomingByWeek(shifts, today);
  const rest = remainingThisWeek(shifts, today);
  const summary =
    rest.count > 0
      ? `Осталось на этой неделе — ${rest.count} ${pluralizeRu(rest.count, "смена", "смены", "смен")} · ${Math.round(rest.hours)} ч`
      : "На этой неделе смен больше нет";
  // Считаем один раз на весь экран: причина одна и та же для каждой строки, и
  // порядок совпадает с swapBlockReason на сервере — сначала общий лок.
  const swapBlockedReason = me.swapsLocked
    ? "Обмены сейчас закрыты"
    : me.excludedFromSwaps
      ? "Обмены тебе закрыты — спроси у админа"
      : undefined;

  return (
    <ScreenScroll>
      <div style={{ margin: "4px 4px 20px" }}>
        {/* `me.address` comes from the server, which knows the person's Telegram
            first name. Splitting `displayName` here gave «Привет, Петров» — the
            roster is written «Фамилия Имя». See `addressOf` in @planer/shared. */}
        <GreetingHero name={me.address} summary={summary} />
      </div>

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
