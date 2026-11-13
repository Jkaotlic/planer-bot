import { formatDayMonth } from "@planer/shared";

export interface ShiftReminderDetails {
  date: string;
  start: string;
  timeRange: string;
  location?: string | null;
}

function escapeText(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function shiftReminderWidget(text: string, shift: ShiftReminderDetails): { caption: string; html: string } | undefined {
  const caption = `Завтра в ${shift.start}\n${text}`;
  // Подпись читают в уведомлении и на старых клиентах. Если она не помещается,
  // отправляем привычный текст целиком, включая авторское сообщение.
  if (caption.length > 1024 || caption.includes("\0")) return undefined;
  const location = shift.location?.replace(/\s+/g, " ").trim().slice(0, 120);
  return {
    caption,
    html: `<style>
body{margin:0;padding:14px;font-family:system-ui;color:var(--tg-theme-text-color)}
h3,p{margin:0}
.heading{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:3px 10px}
h3{font-size:.92em;font-weight:600}
.date{color:var(--tg-theme-hint-color);font-size:.85em;white-space:nowrap}
.time{display:block;margin-top:7px;font-size:1.55em;line-height:1.15;white-space:nowrap}
.location{margin-top:11px;padding-top:8px;border-top:1px solid var(--tg-theme-section-separator-color,var(--tg-theme-hint-color));font-size:.9em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
</style>
<section>
  <div class="heading">
    <h3>Завтра смена</h3>
    <p class="date">${escapeText(formatDayMonth(shift.date))}</p>
  </div>
  <strong class="time">${escapeText(shift.timeRange)}</strong>
  ${location ? `<p class="location">${escapeText(location)}</p>` : ""}
</section>`,
  };
}
