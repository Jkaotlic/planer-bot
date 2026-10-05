import { useEffect } from "react";
import { AdminScheduleScreen } from "./admin/AdminScheduleScreen";
import { AdminWeekendScreen } from "./admin/AdminWeekendScreen";
import { AdminEmployeesScreen } from "./admin/AdminEmployeesScreen";
import { AdminAnnounce } from "./admin/AdminAnnounce";
import { AdminBugs } from "./admin/AdminBugs";
import { AdminJournal } from "./admin/AdminJournal";
import { AdminSettings } from "./admin/AdminSettings";
import { AdminGroups } from "./admin/AdminGroups";
import { AdminChecklists } from "./admin/AdminChecklists";
import { AdminMenu } from "./admin/AdminMenu";
import { Screen } from "../ui";
import { adminSectionTitle, type AdminView } from "./admin-section";

/**
 * Вкладка «Админ»: меню разделов и сами разделы. Каждый раздел сам грузит свои
 * данные и делает свои записи — пока раздел не открыт, ничего не запрашивается,
 * поэтому открыть вкладку дёшево. Рисуется только при `me.isAdmin` (см. `App`), и
 * каждый вызов оттуда проверяется сервером через `requireAdmin`.
 *
 * Что открыто — решает `App` (`view`), чтобы оно пережило уход на другую вкладку.
 */
export function AdminScreen({
  view,
  onViewChange,
  initialDate,
  onInitialDateUsed,
  today,
  onScheduleChanged,
  nearestShortfall,
}: {
  view: AdminView;
  onViewChange: (view: AdminView) => void;
  initialDate?: string;
  /** Дата из ссылки показана — `App` уберёт её, чтобы не прилипла. */
  onInitialDateUsed?: () => void;
  /** Командная дата с сервера (`myShifts.today` из bootstrap) — часы телефона
   *  расходятся с ней рядом с полуночью, и расписание/журнал не должны решать
   *  «какой сегодня день» сами. */
  today: string;
  /** График правили — число нехватки на вкладке «Админ» живёт в `App`. */
  onScheduleChanged?: () => void;
  /** Первый день нехватки на неделю вперёд — для строки «Ближайшая нехватка» в плашке. */
  nearestShortfall?: string | null;
}) {
  // Дата нужна графику только при первом монтировании (`useState` внутри);
  // сразу после — отдаём, что использовали.
  useEffect(() => {
    if (initialDate) onInitialDateUsed?.();
    // Пустые зависимости намеренно: дата — одна, на монтирование.
  }, []);

  if (view === "menu") {
    return (
      <Screen title="Админ">
        <AdminMenu onOpen={onViewChange} />
      </Screen>
    );
  }

  return (
    <Screen title={adminSectionTitle(view)} onBack={() => onViewChange("menu")} backLabel="Разделы" tabBar>
      {view === "schedule" && <AdminScheduleScreen initialDate={initialDate} today={today} onScheduleChanged={onScheduleChanged} nearestShortfall={nearestShortfall} />}
      {view === "weekend" && <AdminWeekendScreen today={today} />}
      {view === "employees" && <AdminEmployeesScreen />}
      {view === "checklists" && <AdminChecklists />}
      {view === "announce" && <AdminAnnounce />}
      {view === "groups" && <AdminGroups />}
      {view === "bugs" && <AdminBugs />}
      {view === "journal" && <AdminJournal today={today} />}
      {view === "settings" && <AdminSettings />}
    </Screen>
  );
}

export default AdminScreen;
