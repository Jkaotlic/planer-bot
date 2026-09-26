import { useState } from "react";
import { AdminScheduleScreen } from "./admin/AdminScheduleScreen";
import { AdminWeekendScreen } from "./admin/AdminWeekendScreen";
import { AdminEmployeesScreen } from "./admin/AdminEmployeesScreen";
import { AdminAnnounce } from "./admin/AdminAnnounce";
import { AdminBugs } from "./admin/AdminBugs";
import { AdminJournal } from "./admin/AdminJournal";
import { AdminSettings } from "./admin/AdminSettings";
import { AdminChecklists } from "./admin/AdminChecklists";
import { SectionChips, SectionPanel } from "../components/SectionChips";
import type { AdminSection } from "./admin-section";

const SECTIONS: readonly { key: AdminSection; label: string }[] = [
  { key: "schedule", label: "Расписание" },
  { key: "weekend", label: "Выходные" },
  { key: "employees", label: "Работники" },
  { key: "checklists", label: "Чек-листы" },
  { key: "announce", label: "Анонсы" },
  { key: "bugs", label: "Баги" },
  { key: "journal", label: "Журнал" },
  { key: "settings", label: "Настройки" },
];

/**
 * The admin-only "Админ" tab: a scrolling chip row over the admin surfaces
 * (schedule / weekend marketplace / workers / collections / announcements /
 * journal / settings). Each sub-screen owns its own data-loading and
 * mutations — nothing is fetched until its section is first shown, so opening
 * the tab is cheap. Rendered only when `me.isAdmin` (see `App`), and every
 * call it makes is `requireAdmin`-guarded server-side.
 */
export function AdminScreen({
  initialSection,
  initialDate,
  today,
}: {
  initialSection?: AdminSection;
  initialDate?: string;
  /** Командная дата с сервера (`myShifts.today` из bootstrap) — часы телефона
   *  расходятся с ней рядом с полуночью, и расписание/журнал не должны решать
   *  «какой сегодня день» сами. */
  today: string;
}) {
  const [section, setSection] = useState<AdminSection>(initialSection ?? "schedule");

  return (
    <div>
      <SectionChips sections={SECTIONS} active={section} onChange={setSection} />

      <SectionPanel active={section}>
        {section === "schedule" && <AdminScheduleScreen initialDate={initialDate} today={today} />}
        {section === "weekend" && <AdminWeekendScreen today={today} />}
        {section === "employees" && <AdminEmployeesScreen />}
        {section === "checklists" && <AdminChecklists />}
        {section === "announce" && <AdminAnnounce />}
        {section === "bugs" && <AdminBugs />}
        {section === "journal" && <AdminJournal today={today} />}
        {section === "settings" && <AdminSettings />}
      </SectionPanel>
    </div>
  );
}

export default AdminScreen;
