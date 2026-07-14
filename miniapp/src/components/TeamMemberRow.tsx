import { Avatar, Cell } from "@telegram-apps/telegram-ui";
import type { Shift } from "../api/client";
import { CategoryChip, categoryLabel } from "../categories";
import { formatTimeRange } from "../lib/shift";
import { initialsOf, personPalette } from "../lib/people";

export interface TeamMemberRowProps {
  shift: Shift;
}

/** A single row in "Команда": who, what they're doing, when, and its category. */
export function TeamMemberRow({ shift }: TeamMemberRowProps) {
  const name = shift.employeeName ?? "Без имени";
  const palette = personPalette(shift.employeeId);
  const heading = shift.title ?? categoryLabel(shift.category);

  return (
    <Cell
      before={<Avatar acronym={initialsOf(name)} size={40} style={{ background: palette.bg, color: palette.fg }} />}
      subtitle={`${formatTimeRange(shift)} · ${heading}`}
      description={<CategoryChip category={shift.category} />}
    >
      {name}
    </Cell>
  );
}
