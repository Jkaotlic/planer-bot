import { createContext, useContext } from "react";
import { toISODate } from "./week";

/**
 * «Сегодня» команды (пояс `teamTz` из `/api/me`; `teamToday` — запасной вариант), а не часов браузера: рядом с
 * полуночью админ в другом поясе или с уехавшими часами видел бы «сегодня» на
 * сутки раньше или позже команды, и неделя, подсветка дня, журнал и чек-лист
 * открывались бы не на тот день. `null` — сервер ещё не ответил (или старый и
 * поля не шлёт): тогда запасной вариант — день браузера, как было до этого.
 */
export const TeamTodayContext = createContext<string | null>(null);

export function useTeamToday(): string {
  // Оба контекста читаются безусловно — правила хуков.
  const tz = useContext(TeamTzContext);
  const served = useContext(TeamTodayContext);
  // Считаем при каждом вызове по поясу команды, а не берём «сегодня», замороженное
  // ответом `/api/me` при загрузке: консоль годами висит открытой вкладкой, и
  // к утру там остался бы вчерашний день (сетка, чек-лист, журнал).
  if (tz) {
    try {
      return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
    } catch {
      // Неизвестный пояс — не повод ронять экран: берём то, что сказал сервер.
    }
  }
  return served ?? toISODate(new Date());
}

/** Пояс команды (`teamTz` из `/api/me`); `undefined` — не пришёл, считают по поясу машины. */
export const TeamTzContext = createContext<string | undefined>(undefined);

export function useTeamTz(): string | undefined {
  return useContext(TeamTzContext);
}
