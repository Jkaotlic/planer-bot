import { Avatar, Cell } from "@telegram-apps/telegram-ui";
import type { Shift, Template } from "../api/client";
import { formatTimeRange } from "../lib/shift";
import { initialsOf, personPalette } from "../lib/people";
import { EntryChip } from "./EntryChip";

export interface TeamMemberRowProps {
  shift: Shift;
  /** Presets, to colour the entry by the one it came from. */
  templates: readonly Template[];
}

/** A single row in "Команда": who, when, and a chip naming the entry in its
 * preset's colour. */
export function TeamMemberRow({ shift, templates }: TeamMemberRowProps) {
  const name = shift.employeeName ?? "Без имени";
  const palette = personPalette(shift.employeeId);

  return (
    <Cell
      before={<Avatar acronym={initialsOf(name)} size={40} style={{ background: palette.bg, color: palette.fg }} />}
      // The entry's label moves out of the subtitle and into the chip below it,
      // which now carries that same text in the preset's colour.
      subtitle={formatTimeRange(shift)}
      description={<EntryChip entry={shift} templates={templates} />}
    >
      {name}
    </Cell>
  );
}
