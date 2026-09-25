import { categoryLabel } from "@planer/shared";
import type { Shift } from "../api/client";
import { formatTimeRange } from "../lib/shift";

export interface DayTeamListProps {
  /** Уже отфильтрованные и отсортированные записи (см. `coworkersOf`) —
   *  компонент их только рисует, отбор и порядок не его дело. */
  shifts: readonly Shift[];
}

/**
 * «Кто ещё работает в этот день»: «Имя · 09:00–18:00 · Вид» построчно.
 *
 * Общий для листа под своей сменой («Моих сменах») — единственное место, где
 * этот формат живёт сейчас; расширять его в «Кто ещё работает» экрана обмена
 * (ProposeSwapScreen) не стали — там строка несёт выбор (radio, поиск,
 * `data-testid="swap-candidate"`), и заменять её на read-only список значило
 * бы переписывать протестированную интерактивность вслепую, без падающего
 * теста, который бы это потребовал.
 */
export function DayTeamList({ shifts }: DayTeamListProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {shifts.map((shift) => (
        <div key={shift.id} style={{ fontSize: 14, lineHeight: 1.4, color: "var(--tgui--text_color)" }}>
          {shift.employeeName ?? "Коллега"} · {formatTimeRange(shift)} · {shift.title ?? categoryLabel(shift.category)}
        </div>
      ))}
    </div>
  );
}
