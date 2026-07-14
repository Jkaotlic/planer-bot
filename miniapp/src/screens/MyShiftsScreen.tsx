import { List, Placeholder, Section } from "@telegram-apps/telegram-ui";
import type { Me, Shift } from "../api/client";
import { GreetingHero } from "../components/GreetingHero";
import { ShiftRow } from "../components/ShiftRow";
import { addDays, firstName, formatWeekRangeLabel, mondayOf } from "../lib/week";
import { pluralizeRu, totalHours } from "../lib/shift";

export interface MyShiftsScreenProps {
  me: Me;
  shifts: Shift[];
}

/** "Мои смены": a greeting hero, a week-hours summary, and the caller's own shifts. */
export function MyShiftsScreen({ me, shifts }: MyShiftsScreenProps) {
  const monday = mondayOf(new Date());
  const weekLabel = formatWeekRangeLabel(monday, addDays(monday, 6));

  const workShifts = shifts.filter((s) => s.category === "shift");
  const hours = Math.round(totalHours(workShifts));
  const countLabel = `${workShifts.length} ${pluralizeRu(workShifts.length, "смена", "смены", "смен")}`;
  const summary = shifts.length > 0 ? `Эта неделя — ${countLabel} · ${hours} ч` : "На этой неделе смен нет";

  const sorted = [...shifts].sort((a, b) => a.date.localeCompare(b.date));

  return (
    <div style={{ padding: "16px 16px 0" }}>
      <div style={{ margin: "4px 4px 20px" }}>
        <GreetingHero name={firstName(me.displayName)} summary={summary} />
      </div>

      {sorted.length === 0 ? (
        <Placeholder header="Пока нет смен" description="Здесь появятся ваши ближайшие смены и отпуска." />
      ) : (
        <List>
          <Section header={`Мои смены · ${weekLabel}`}>
            {sorted.map((shift) => (
              <ShiftRow key={shift.id} shift={shift} />
            ))}
          </Section>
        </List>
      )}
    </div>
  );
}
