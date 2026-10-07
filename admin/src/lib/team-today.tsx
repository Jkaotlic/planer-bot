import { createContext, useContext } from "react";
import { toISODate } from "./week";

/**
 * «Сегодня» команды (`teamToday` из `/api/me`), а не часов браузера: рядом с
 * полуночью админ в другом поясе или с уехавшими часами видел бы «сегодня» на
 * сутки раньше или позже команды, и неделя, подсветка дня, журнал и чек-лист
 * открывались бы не на тот день. `null` — сервер ещё не ответил (или старый и
 * поля не шлёт): тогда запасной вариант — день браузера, как было до этого.
 */
export const TeamTodayContext = createContext<string | null>(null);

export function useTeamToday(): string {
  return useContext(TeamTodayContext) ?? toISODate(new Date());
}
