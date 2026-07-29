import { List, Placeholder, Section } from "@telegram-apps/telegram-ui";
import type { Me, Shift, Template } from "../api/client";
import { AddressField } from "../components/AddressField";
import { GreetingHero } from "../components/GreetingHero";
import { ScreenScroll } from "../components/ScreenScroll";
import { ShiftRow } from "../components/ShiftRow";
import { RemindersSwitch } from "../components/RemindersSwitch";
import { addDays, formatWeekRangeLabel, mondayOf, toISODate } from "../lib/week";
import { pluralizeRu, totalHours } from "../lib/shift";

export interface MyShiftsScreenProps {
  me: Me;
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

/** "Мои смены": a greeting hero, a week-hours summary, the caller's own shifts,
 *  and their reminders switch. */
export function MyShiftsScreen({ me, shifts, templates, onProposeSwap, onRemindersChanged, onAddressChanged }: MyShiftsScreenProps) {
  const monday = mondayOf(new Date());
  const weekLabel = formatWeekRangeLabel(monday, addDays(monday, 6));
  const today = toISODate(new Date());

  const workShifts = shifts.filter((s) => s.category === "shift");
  const hours = Math.round(totalHours(workShifts));
  const countLabel = `${workShifts.length} ${pluralizeRu(workShifts.length, "смена", "смены", "смен")}`;
  const summary = shifts.length > 0 ? `Эта неделя — ${countLabel} · ${hours} ч` : "На этой неделе смен нет";

  const sorted = [...shifts].sort((a, b) => a.date.localeCompare(b.date));

  return (
    <ScreenScroll>
      <div style={{ margin: "4px 4px 20px" }}>
        {/* `me.address` comes from the server, which knows the person's Telegram
            first name. Splitting `displayName` here gave «Привет, Петров» — the
            roster is written «Фамилия Имя». See `addressOf` in @planer/shared. */}
        <GreetingHero name={me.address} summary={summary} />
      </div>

      {sorted.length === 0 ? (
        <Placeholder header="Пока нет смен" description="Здесь появятся ваши ближайшие смены и отпуска." />
      ) : (
        <List>
          <Section header={`Мои смены · ${weekLabel}`}>
            {sorted.map((shift) => (
              <ShiftRow key={shift.id} shift={shift} templates={templates} onSwap={onProposeSwap} isToday={shift.date === today} />
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
