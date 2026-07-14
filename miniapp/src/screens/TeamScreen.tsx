import type { ReactNode } from "react";
import { List, Placeholder, Section, Subheadline, Title } from "@telegram-apps/telegram-ui";
import type { Shift } from "../api/client";
import { TeamMemberRow } from "../components/TeamMemberRow";
import { addDays, formatDayLabel, formatWeekRangeLabel, isWeekendIso, mondayOf, toISODate } from "../lib/week";

export interface TeamScreenProps {
  shifts: Shift[];
}

/** "Команда": the whole team's schedule for the week, grouped by day. */
export function TeamScreen({ shifts }: TeamScreenProps) {
  const monday = mondayOf(new Date());
  const days = Array.from({ length: 7 }, (_, i) => toISODate(addDays(monday, i)));
  const weekLabel = formatWeekRangeLabel(monday, addDays(monday, 6));

  const byDay = days.map((day) => ({
    day,
    shifts: shifts
      .filter((s) => s.date <= day && (s.endDate ?? s.date) >= day)
      .sort((a, b) => (a.start ?? "").localeCompare(b.start ?? "")),
  }));
  const hasAnything = byDay.some((group) => group.shifts.length > 0);

  return (
    <div style={{ padding: "16px 16px 0" }}>
      <header style={{ margin: "8px 4px 20px" }}>
        <Title level="2" weight="2">
          Команда
        </Title>
        <Subheadline level="2" style={{ color: "var(--tgui--hint_color)", marginTop: 4 }}>
          {weekLabel}
        </Subheadline>
      </header>

      {!hasAnything ? (
        <Placeholder header="Пока пусто" description="На этой неделе в расписании команды ничего нет." />
      ) : (
        <List>
          {byDay.map(
            ({ day, shifts: dayShifts }) =>
              dayShifts.length > 0 && (
                <Section key={day} header={<DaySectionHeader day={day} />}>
                  {dayShifts.map((s) => (
                    <TeamMemberRow key={`${day}-${s.id}`} shift={s} />
                  ))}
                </Section>
              ),
          )}
        </List>
      )}
    </div>
  );
}

function DaySectionHeader({ day }: { day: string }): ReactNode {
  const weekend = isWeekendIso(day);
  return (
    <>
      {formatDayLabel(day)}
      {weekend && <span style={{ color: "var(--tgui--hint_color)", fontWeight: 400 }}> · выходной</span>}
    </>
  );
}
