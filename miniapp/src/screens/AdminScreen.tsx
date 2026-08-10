import { useState } from "react";
import { AdminScheduleScreen } from "./admin/AdminScheduleScreen";
import { AdminWeekendScreen } from "./admin/AdminWeekendScreen";
import { AdminEmployeesScreen } from "./admin/AdminEmployeesScreen";
import { AdminCollections } from "./admin/AdminCollections";
import { AdminJournal } from "./admin/AdminJournal";
import { AdminSettings } from "./admin/AdminSettings";
import { SectionChips, SectionPanel } from "../components/SectionChips";
import { toISODate } from "../lib/week";

type AdminSection = "schedule" | "weekend" | "employees" | "collections" | "journal" | "settings";

const SECTIONS: readonly { key: AdminSection; label: string }[] = [
  { key: "schedule", label: "Расписание" },
  { key: "weekend", label: "Выходные" },
  { key: "employees", label: "Работники" },
  { key: "collections", label: "Сборы" },
  { key: "journal", label: "Журнал" },
  { key: "settings", label: "Настройки" },
];

/**
 * The admin-only "Админ" tab: a scrolling chip row over the six admin surfaces
 * (schedule / weekend marketplace / workers / collections / journal / settings).
 * Each sub-screen owns its own data-loading and mutations — nothing is fetched
 * until its section is first shown, so opening the tab is cheap. Rendered only
 * when `me.isAdmin` (see `App`), and every call it makes is `requireAdmin`-guarded
 * server-side.
 */
export function AdminScreen() {
  const [section, setSection] = useState<AdminSection>("schedule");

  return (
    <div>
      <SectionChips sections={SECTIONS} active={section} onChange={setSection} />

      <SectionPanel active={section}>
        {section === "schedule" && <AdminScheduleScreen />}
        {section === "weekend" && <AdminWeekendScreen />}
        {section === "employees" && <AdminEmployeesScreen />}
        {section === "collections" && <AdminCollections />}
        {section === "journal" && <AdminJournal today={toISODate(new Date())} />}
        {section === "settings" && <AdminSettings />}
      </SectionPanel>
    </div>
  );
}
