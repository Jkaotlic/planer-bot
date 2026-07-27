import { Modal } from "@telegram-apps/telegram-ui";
import type { TeamEntryView } from "../../lib/team-schedule";

export interface TeamEntryDetailRow {
  id: number;
  title: string;
  time: string;
  location: string | null;
  dateRange: string;
}

export function toTeamEntryDetailRows(
  entries: readonly TeamEntryView[],
): TeamEntryDetailRow[] {
  return entries.map(({ shift, title }) => ({
    id: shift.id,
    title,
    time: shift.start && shift.end ? `${shift.start}–${shift.end}` : "Весь день",
    location: shift.location ? `Место: ${shift.location}` : null,
    dateRange:
      shift.endDate && shift.endDate !== shift.date
        ? `${shift.date} — ${shift.endDate}`
        : shift.date,
  }));
}

export function TeamEntryDetails({
  open,
  entries,
  onOpenChange,
}: {
  open: boolean;
  entries: readonly TeamEntryView[];
  onOpenChange: (open: boolean) => void;
}) {
  const rows = toTeamEntryDetailRows(entries);

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      header={<Modal.Header>Смена</Modal.Header>}
    >
      <div className="team-details">
        {rows.map((row) => (
          <article key={row.id} className="team-details__entry">
            <strong>{row.title}</strong>
            <span>{row.time}</span>
            {row.location && <span>{row.location}</span>}
            <span>{row.dateRange}</span>
          </article>
        ))}
      </div>
    </Modal>
  );
}
