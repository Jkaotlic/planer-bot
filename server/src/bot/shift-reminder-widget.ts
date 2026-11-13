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
body{margin:0;padding:12px;font-family:system-ui;color:var(--tg-theme-text-color)}
h3,p{margin:0}h3{font-size:1.15em}strong{display:block;font-size:1.35em;margin:5px 0 10px}
.date{color:var(--tg-theme-hint-color);font-size:.85em}
.location{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
</style>
<section>
  <p class="date">${escapeText(formatDayMonth(shift.date))}</p>
  <h3>Завтра смена</h3>
  <strong>${escapeText(shift.timeRange)}</strong>
  ${location ? `<p class="location">${escapeText(location)}</p>` : ""}
</section>`,
  };
}
