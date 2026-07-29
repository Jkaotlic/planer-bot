import { useState } from "react";
import { AdminScheduleScreen } from "./admin/AdminScheduleScreen";
import { AdminWeekendScreen } from "./admin/AdminWeekendScreen";
import { AdminEmployeesScreen } from "./admin/AdminEmployeesScreen";
import { AdminBirthdays } from "./admin/AdminBirthdays";
import { AdminJournal } from "./admin/AdminJournal";
import { SectionChips, SectionPanel } from "../components/SectionChips";
import { toISODate } from "../lib/week";

type AdminSection = "schedule" | "weekend" | "employees" | "birthdays" | "journal";

const SECTIONS: readonly { key: AdminSection; label: string }[] = [
  { key: "schedule", label: "Расписание" },
  { key: "weekend", label: "Выходные" },
  { key: "employees", label: "Работники" },
  { key: "birthdays", label: "Дни рождения" },
  { key: "journal", label: "Журнал" },
];

/**
 * The admin-only "Админ" tab: a scrolling chip row over the five admin surfaces
 * (schedule / weekend marketplace / workers / birthdays / journal). Each
 * sub-screen owns its own data-loading and mutations — nothing is fetched until
 * its section is first shown, so opening the tab is cheap. Rendered only when
 * `me.isAdmin` (see `App`), and every call it makes is `requireAdmin`-guarded
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
        {section === "birthdays" && <AdminBirthdays />}
        {section === "journal" && <AdminJournal today={toISODate(new Date())} />}
      </SectionPanel>
    </div>
  );
}
