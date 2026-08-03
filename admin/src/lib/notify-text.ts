/**
 * Дописывается к уже существующему сообщению об успехе (импорт CSV, сохранение
 * записи, рассылка ДР) — отдельного места на экране для неё не заводим. Правило
 * то же, что у `reachNotice` (WeekendAdminScreen.tsx): молчим, когда дошло до
 * всех или уведомлять было некого, говорим вслух, когда часть команды не
 * подключила телеграм. Дублирует одноимённую пару в miniapp/src/lib/shift.ts —
 * эта консоль не делит фронтенд-код с мини-аппом, ровно как reachNotice.
 */
export function notifyNotice(reach: { delivered: number; intended: number }): string | null {
  if (reach.intended === 0 || reach.delivered >= reach.intended) return null;
  return `Уведомление дошло до ${reach.delivered} из ${reach.intended}: остальные не подключили телеграм.`;
}

/** Приписывает `notifyNotice` к базовому сообщению, если есть что сказать. */
export function withNotifyNotice(base: string, reach: { delivered: number; intended: number }): string {
  const extra = notifyNotice(reach);
  return extra ? `${base} ${extra}` : base;
}
