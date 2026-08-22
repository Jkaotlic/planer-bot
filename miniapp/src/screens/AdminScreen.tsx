import { useState } from "react";
import { AdminScheduleScreen } from "./admin/AdminScheduleScreen";
import { AdminWeekendScreen } from "./admin/AdminWeekendScreen";
import { AdminEmployeesScreen } from "./admin/AdminEmployeesScreen";
import { AdminCollections } from "./admin/AdminCollections";
import { AdminAnnounce } from "./admin/AdminAnnounce";
import { AdminBugs } from "./admin/AdminBugs";
import { AdminJournal } from "./admin/AdminJournal";
import { AdminSettings } from "./admin/AdminSettings";
import { AdminChecklists } from "./admin/AdminChecklists";
import { SectionChips, SectionPanel } from "../components/SectionChips";
import { toISODate } from "../lib/week";
import type { AdminSection } from "./admin-section";

const SECTIONS: readonly { key: AdminSection; label: string }[] = [
  { key: "schedule", label: "Расписание" },
  { key: "weekend", label: "Выходные" },
  { key: "employees", label: "Работники" },
  { key: "checklists", label: "Чек-листы" },
  { key: "collections", label: "Сборы" },
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
export function AdminScreen({ initialSection }: { initialSection?: AdminSection }) {
  const [section, setSection] = useState<AdminSection>(initialSection ?? "schedule");

  return (
    <div>
      <SectionChips sections={SECTIONS} active={section} onChange={setSection} />

      <SectionPanel active={section}>
        {section === "schedule" && <AdminScheduleScreen />}
        {section === "weekend" && <AdminWeekendScreen />}
        {section === "employees" && <AdminEmployeesScreen />}
        {section === "checklists" && <AdminChecklists />}
        {section === "collections" && <AdminCollections />}
        {section === "announce" && <AdminAnnounce />}
        {section === "bugs" && <AdminBugs />}
        {section === "journal" && <AdminJournal today={toISODate(new Date())} />}
        {section === "settings" && <AdminSettings />}
      </SectionPanel>
    </div>
  );
}

export default AdminScreen;
